/**
 * Pyodide 执行 Worker。
 *
 * 跑在独立线程里，原因不只是「不卡主线程」——
 * Pyodide 执行 Python 是**同步阻塞**的，Worker 内部没有可靠的中断手段。
 * 死循环唯一的止损方式是主线程 terminate 整个 Worker，
 * 而这只有把执行放进 Worker 才做得到。
 *
 * 实际执行逻辑在 harness.ts，与单元测试共享，避免两份实现漂移。
 */

/// <reference lib="webworker" />

import { executeCodeQuestion, TEST_HARNESS, type MinimalPyodide } from './harness';
import {
	PYODIDE_CDN_URL,
	PYODIDE_LOCAL_PATH,
	type WorkerRequest,
	type WorkerResponse
} from './messages';

let pyodide: MinimalPyodide | null = null;
const loadedPackages = new Set<string>();
/** 主线程传来的同源基址，含 base path */
let originBase = '';

function post(msg: WorkerResponse): void {
	self.postMessage(msg);
}

/**
 * 按「同源 → CDN」顺序尝试加载。
 *
 * 同源资源由 scripts/sync-pyodide.mjs 放在 static/pyodide/，
 * 走站点自己的 CDN，比第三方快一个量级。
 */
async function loadFrom(indexURL: string): Promise<MinimalPyodide> {
	// @vite-ignore 必需：URL 在构建期未知，不能让 Vite 尝试解析
	const mod = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`);
	return (await mod.loadPyodide({ indexURL })) as MinimalPyodide;
}

async function ensurePyodide(): Promise<MinimalPyodide> {
	if (pyodide) return pyodide;

	const sameOrigin = `${originBase}${PYODIDE_LOCAL_PATH}`;
	let instance: MinimalPyodide;

	post({ type: 'progress', detail: '正在加载 Python 运行时' });
	try {
		instance = await loadFrom(sameOrigin);
	} catch (localError) {
		// 同源资源缺失（比如部署时漏跑 sync 脚本）时退到 CDN。
		// 会明显更慢，但慢总比完全不可用好。
		post({ type: 'progress', detail: '本地资源不可用，改从 CDN 加载（会慢很多）' });
		try {
			instance = await loadFrom(PYODIDE_CDN_URL);
		} catch (cdnError) {
			// 附上 cause 保留错误链：两条路径都失败时，
			// 排查需要知道原始异常是网络问题、CORS 还是资源 404。
			throw new Error(
				`Python 运行时加载失败（同源与 CDN 均不可用）。\n` +
					`同源 ${sameOrigin}：${
						localError instanceof Error ? localError.message : String(localError)
					}\n` +
					`CDN ${PYODIDE_CDN_URL}：${
						cdnError instanceof Error ? cdnError.message : String(cdnError)
					}`,
				{ cause: cdnError }
			);
		}
	}

	post({ type: 'progress', detail: '正在初始化解释器' });
	instance.runPython(TEST_HARNESS);
	pyodide = instance;
	post({ type: 'ready' });
	return instance;
}

async function handleRun(req: Extract<WorkerRequest, { type: 'run' }>): Promise<void> {
	try {
		const py = await ensurePyodide();
		const result = await executeCodeQuestion(py, {
			setupCode: req.setupCode,
			userCode: req.userCode,
			tests: req.tests,
			packages: req.packages,
			loadedPackages,
			onProgress: (detail) => post({ type: 'progress', detail })
		});
		post({ type: 'result', id: req.id, result });
	} catch (e) {
		// 走到这里说明是 Pyodide 加载或框架自身的问题，不是用户代码的错。
		// 必须区分开：否则用户会以为自己写错了。
		post({
			type: 'result',
			id: req.id,
			result: {
				correct: false,
				outcome: 'unavailable',
				tests: [],
				stdout: '',
				error: e instanceof Error ? e.message : String(e)
			}
		});
	}
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
	const req = event.data;

	if (req.type === 'configure') {
		originBase = req.originBase;
		return;
	}

	if (req.type === 'warmup') {
		void ensurePyodide().catch((e) =>
			post({
				type: 'result',
				id: 'warmup',
				result: {
					correct: false,
					outcome: 'unavailable',
					tests: [],
					stdout: '',
					error: e instanceof Error ? e.message : String(e)
				}
			})
		);
		return;
	}

	if (req.type === 'run') void handleRun(req);
});
