/**
 * Pyodide 执行器（主线程侧）。
 *
 * 三个必须处理好的现实：
 *
 * 1. **体积**：Pyodide 核心约 10MB，加 numpy 更多。所以严格懒加载——
 *    只在用户真的点「运行」时才创建 Worker，阅读页面完全不碰。
 *
 * 2. **死循环**：Python 在 Worker 里是同步执行的，`while True` 无法从内部打断。
 *    唯一可靠的止损是 terminate 整个 Worker，代价是下次运行要重新加载 Pyodide。
 *    这个代价必须让用户知道，不能静默发生。
 *
 * 3. **CDN 不可用**：资源来自 jsDelivr。拿不到时要明确降级，而不是无限转圈。
 */

import { base } from '$app/paths';
import type { CodeQuestion, CodeRunResult } from '$lib/quiz/types';
import type { WorkerRequest, WorkerResponse } from './messages';

/** 单次运行的墙钟上限。超过就认定是死循环或算得太久 */
export const RUN_TIMEOUT_MS = 15_000;

/** Pyodide 首次加载的上限。CDN 慢或不可用时避免无限等待 */
export const LOAD_TIMEOUT_MS = 60_000;

export interface RunnerEvents {
	/** 加载进度文案，用于替代干等 */
	onProgress?: (detail: string) => void;
	/** Pyodide 就绪。之后的运行不再有加载开销 */
	onReady?: () => void;
}

export class PythonRunner {
	#worker: Worker | null = null;
	#events: RunnerEvents;
	/** 当前运行的 id → 完成回调 */
	#pending = new Map<string, (r: CodeRunResult) => void>();
	#seq = 0;
	/** Pyodide 是否已就绪。terminate 后要复位 */
	#ready = false;

	constructor(events: RunnerEvents = {}) {
		this.#events = events;
	}

	get isReady(): boolean {
		return this.#ready;
	}

	/** Worker 是否已创建。用于界面判断「首次运行会比较慢」 */
	get isStarted(): boolean {
		return this.#worker !== null;
	}

	#ensureWorker(): Worker {
		if (this.#worker) return this.#worker;

		// Vite 的 ?worker 后缀会把它打成独立 chunk，不进主 bundle
		const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

		worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
			const msg = event.data;
			if (msg.type === 'progress') {
				this.#events.onProgress?.(msg.detail);
				return;
			}
			if (msg.type === 'ready') {
				this.#ready = true;
				this.#events.onReady?.();
				return;
			}
			if (msg.type === 'result') {
				const resolve = this.#pending.get(msg.id);
				if (resolve) {
					this.#pending.delete(msg.id);
					resolve(msg.result);
				}
			}
		});

		worker.addEventListener('error', (e) => {
			// Worker 自身崩溃：把所有等待中的请求都以 unavailable 结束，
			// 否则调用方会永远挂着
			const message = e.message || 'Worker 执行出错';
			for (const [, resolve] of this.#pending) {
				resolve({
					correct: false,
					outcome: 'unavailable',
					tests: [],
					stdout: '',
					error: message
				});
			}
			this.#pending.clear();
			this.#dispose();
		});

		// 立刻告知同源基址。base path 由 SvelteKit 提供，
		// 拼成绝对 URL 后 Worker 才能正确定位 static/pyodide/。
		const originBase = new URL(`${base}/`, location.origin).href;
		worker.postMessage({ type: 'configure', originBase } satisfies WorkerRequest);

		this.#worker = worker;
		return worker;
	}

	#dispose(): void {
		this.#worker?.terminate();
		this.#worker = null;
		this.#ready = false;
	}

	/**
	 * 提前开始加载 Pyodide。
	 *
	 * 只在明确的用户意图之后调用（比如聚焦编辑器），
	 * 不要在页面加载时调用——那等于把 10MB 强加给只想阅读的人。
	 */
	warmup(): void {
		const worker = this.#ensureWorker();
		const req: WorkerRequest = { type: 'warmup' };
		worker.postMessage(req);
	}

	/**
	 * 运行用户代码并跑测试。
	 *
	 * 超时会 terminate Worker，返回 outcome: 'timeout'。
	 * 之后下一次运行需要重新加载 Pyodide。
	 */
	async run(question: CodeQuestion, userCode: string): Promise<CodeRunResult> {
		const worker = this.#ensureWorker();
		const id = `run-${++this.#seq}`;

		// 首次加载允许更长时间，之后只给执行时间
		const budget = this.#ready ? RUN_TIMEOUT_MS : LOAD_TIMEOUT_MS + RUN_TIMEOUT_MS;

		return new Promise<CodeRunResult>((resolve) => {
			let settled = false;
			const finish = (result: CodeRunResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.#pending.delete(id);
				resolve(result);
			};

			const timer = setTimeout(() => {
				// 唯一可靠的中断手段。Worker 里的同步 Python 循环
				// 不会响应任何消息，只能整个杀掉。
				this.#dispose();
				finish({
					correct: false,
					outcome: 'timeout',
					tests: [],
					stdout: '',
					error: `执行超过 ${Math.round(budget / 1000)} 秒被中断。检查是否有死循环。`
				});
			}, budget);

			this.#pending.set(id, finish);

			const req: WorkerRequest = {
				type: 'run',
				id,
				setupCode: question.setupCode,
				userCode,
				tests: question.tests,
				packages: question.packages
			};
			worker.postMessage(req);
		});
	}

	/** 释放资源。组件卸载时调用 */
	destroy(): void {
		this.#pending.clear();
		this.#dispose();
	}
}
