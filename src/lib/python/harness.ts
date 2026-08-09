/**
 * 代码题的执行内核。
 *
 * Worker（浏览器）和单元测试（Node）都调用这里，
 * 保证「测试里验证过的行为」与「用户实际遇到的行为」是同一套逻辑。
 * 如果各写一份，两者会慢慢漂移，最后出现测试全绿但线上判错的情况。
 */

import type { CodeRunResult, CodeTestCase } from '$lib/quiz/types';

/** Pyodide 实例中本模块实际用到的部分 */
export interface MinimalPyodide {
	runPython(code: string): unknown;
	loadPackage(names: string[]): Promise<unknown>;
	setStdout(opts: { batched: (s: string) => void }): void;
	setStderr(opts: { batched: (s: string) => void }): void;
	globals: { set(name: string, value: unknown): void };
}

/**
 * Python 侧的测试执行框架。
 *
 * 关键设计是**逐条捕获**而不是一次性 assert：
 * 「3/5 通过，形状对了但没归一化」比「失败」有用得多。
 *
 * 各用例共享用户代码定义的全局命名空间，所以后面的用例
 * 可以引用前面创建的变量——这符合直觉，也让断言写起来更短。
 */
export const TEST_HARNESS = `
import json as __ael_json

def __ael_run_tests(__ael_cases):
    __ael_out = []
    for __ael_label, __ael_code in __ael_cases:
        try:
            exec(__ael_code, globals())
            __ael_out.append({"label": __ael_label, "passed": True})
        except AssertionError as __ael_e:
            __ael_msg = str(__ael_e).strip() or "断言不成立"
            __ael_out.append({"label": __ael_label, "passed": False, "message": __ael_msg})
        except Exception as __ael_e:
            __ael_out.append({
                "label": __ael_label,
                "passed": False,
                "message": f"{type(__ael_e).__name__}: {__ael_e}"
            })
    return __ael_json.dumps(__ael_out, ensure_ascii=False)
`;

/**
 * 从 Pyodide 抛出的错误里取出对用户有用的部分。
 *
 * Python traceback 的前几行是我们的框架代码，对用户是纯噪声。
 * 只保留末尾几行——异常类型和消息在那里。
 */
export function extractPythonError(e: unknown, stderr = ''): string {
	const text = e instanceof Error ? e.message : String(e);
	const meaningful = text
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l !== '')
		.filter(
			(l) => !l.includes('/lib/python') && !l.includes('__ael_') && !l.includes('File "<exec>"')
		);

	return meaningful.slice(-4).join('\n') || stderr.trim() || text;
}

export interface ExecuteOptions {
	setupCode?: string;
	userCode: string;
	tests: CodeTestCase[];
	/** 已加载的包集合，会被就地更新以避免重复 loadPackage */
	packages?: string[];
	loadedPackages?: Set<string>;
	onProgress?: (detail: string) => void;
}

/**
 * 执行一道代码题。
 *
 * 注意 setup、用户代码、测试是**三次独立的 runPython**：
 * 这样用户代码自己的语法错误能与测试断言失败区分开，
 * 界面才能给出不同的反馈（「你的代码报错了」vs「有 2 条用例没通过」）。
 *
 * @param py 已初始化且已执行过 TEST_HARNESS 的 Pyodide 实例
 */
export async function executeCodeQuestion(
	py: MinimalPyodide,
	opts: ExecuteOptions
): Promise<CodeRunResult> {
	const { setupCode, userCode, tests, packages = [], loadedPackages, onProgress } = opts;
	let stdout = '';
	let stderr = '';

	const missing = loadedPackages ? packages.filter((p) => !loadedPackages.has(p)) : packages;
	if (missing.length > 0) {
		onProgress?.(`正在加载 ${missing.join('、')}`);
		await py.loadPackage(missing);
		for (const p of missing) loadedPackages?.add(p);
	}

	// 每次运行前重置捕获，否则会累积上一次的输出
	py.setStdout({ batched: (s) => (stdout += s + '\n') });
	py.setStderr({ batched: (s) => (stderr += s + '\n') });

	const startedAt = Date.now();

	if (setupCode) py.runPython(setupCode);

	try {
		py.runPython(userCode);
	} catch (e) {
		return {
			correct: false,
			outcome: 'error',
			tests: [],
			stdout,
			error: extractPythonError(e, stderr),
			durationMs: Date.now() - startedAt
		};
	}

	// 用 globals 传数组而不是拼字符串：题目里的引号和换行会破坏拼接
	py.globals.set(
		'__ael_cases_js',
		tests.map((t) => [t.label, t.code])
	);
	const raw = py.runPython('__ael_run_tests(__ael_cases_js.to_py())');
	const results = JSON.parse(String(raw)) as CodeRunResult['tests'];

	const allPassed = results.every((r) => r.passed);
	return {
		correct: allPassed,
		outcome: allPassed ? 'pass' : 'fail',
		tests: results,
		stdout,
		durationMs: Date.now() - startedAt
	};
}
