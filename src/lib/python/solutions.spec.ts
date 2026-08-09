/**
 * 用真实 Pyodide 验证代码题自洽。
 *
 * 这是代码题的「数值独立重算」等价物，回答两个问题：
 *
 * 1. **参考答案真的能通过全部测试吗？** 不验证的话可能出一道无解的题，
 *    用户怎么写都过不了，而这种缺陷极难被发现——作者自己不会去做题。
 * 2. **起始代码真的会失败吗？** 如果 starterCode 就能通过，
 *    用户什么都不做就"答对"了，题目毫无意义。
 *
 * Node 下 Pyodide 从 node_modules 加载本地 WASM（约 13MB），不依赖网络。
 * 加载要几秒，所以这个文件的超时设得比默认长。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { executeCodeQuestion, TEST_HARNESS, type MinimalPyodide } from './harness';
import { KV_CACHE_CODE_QUESTIONS } from '$lib/quiz/kv-cache-code-questions';
import { ATTENTION_QUESTIONS } from '$lib/quiz/attention-questions';
import { BACKPROP_QUESTIONS } from '$lib/quiz/backprop-questions';
import { TOKENIZER_QUESTIONS } from '$lib/quiz/tokenizer-questions';
import type { CodeQuestion } from '$lib/quiz/types';

/** Pyodide 初始化 + 每题跑两遍（参考答案和起始代码），给足预算 */
const TIMEOUT = 120_000;

let py: MinimalPyodide;

beforeAll(async () => {
	py = (await loadPyodide()) as unknown as MinimalPyodide;
	py.runPython(TEST_HARNESS);
}, TIMEOUT);

/** 所有代码题。将来有别的关卡时在这里追加 */
const ALL_CODE_QUESTIONS: CodeQuestion[] = [
	...KV_CACHE_CODE_QUESTIONS,
	// 从混合题库里筛出代码题
	...ATTENTION_QUESTIONS.filter((q): q is CodeQuestion => q.kind === 'code'),
	...BACKPROP_QUESTIONS.filter((q): q is CodeQuestion => q.kind === 'code'),
	...TOKENIZER_QUESTIONS.filter((q): q is CodeQuestion => q.kind === 'code')
];

describe('代码题自洽性', () => {
	it('至少有一道代码题', () => {
		expect(ALL_CODE_QUESTIONS.length).toBeGreaterThan(0);
	});

	for (const q of ALL_CODE_QUESTIONS) {
		describe(q.id, () => {
			it(
				'参考答案通过全部测试用例',
				async () => {
					const result = await executeCodeQuestion(py, {
						setupCode: q.setupCode,
						userCode: q.solutionCode,
						tests: q.tests,
						packages: q.packages
					});

					// 失败时把每条用例的原因打出来，否则排查要靠猜
					if (!result.correct) {
						const detail = result.tests
							.map(
								(t) => `  ${t.passed ? '✓' : '✗'} ${t.label}${t.message ? ` — ${t.message}` : ''}`
							)
							.join('\n');
						throw new Error(
							`参考答案未通过（outcome=${result.outcome}）\n${detail}\n` +
								(result.error ? `error: ${result.error}\n` : '') +
								(result.stdout ? `stdout: ${result.stdout}` : '')
						);
					}

					expect(result.outcome).toBe('pass');
					expect(result.tests).toHaveLength(q.tests.length);
					expect(result.tests.every((t) => t.passed)).toBe(true);
				},
				TIMEOUT
			);

			it(
				'起始代码不能通过（否则题目没有意义）',
				async () => {
					const result = await executeCodeQuestion(py, {
						setupCode: q.setupCode,
						userCode: q.starterCode,
						tests: q.tests,
						packages: q.packages
					});
					expect(result.correct, '起始代码通过了测试，用户什么都不做就能"答对"').toBe(false);
				},
				TIMEOUT
			);

			it(
				'每条测试用例都真的在检查东西（不会恒真）',
				async () => {
					// 逐条验证：只有起始代码时，至少要有用例失败。
					// 恒真的用例（比如忘了写 assert）在这里暴露不出来，
					// 所以再叠加一层：用参考答案跑时全过、用起始代码跑时该条应失败。
					const withSolution = await executeCodeQuestion(py, {
						setupCode: q.setupCode,
						userCode: q.solutionCode,
						tests: q.tests,
						packages: q.packages
					});
					const withStarter = await executeCodeQuestion(py, {
						setupCode: q.setupCode,
						userCode: q.starterCode,
						tests: q.tests,
						packages: q.packages
					});

					const alwaysTrue = q.tests.filter((t, i) => {
						const solved = withSolution.tests[i]?.passed === true;
						const starterAlsoPassed = withStarter.tests[i]?.passed === true;
						return solved && starterAlsoPassed;
					});

					expect(
						alwaysTrue.map((t) => t.label),
						'这些用例在起始代码下也通过，说明它们没有真正检查实现'
					).toEqual([]);
				},
				TIMEOUT
			);
		});
	}
});

describe('执行内核行为', () => {
	const dummyTests = [{ label: '恒成立', code: 'assert True' }];

	it(
		'用户代码语法错误时 outcome 为 error 而非 fail',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'def broken(:\n    pass',
				tests: dummyTests
			});
			expect(result.outcome).toBe('error');
			expect(result.correct).toBe(false);
			// 报错信息要能看出是语法问题
			expect(result.error).toBeTruthy();
		},
		TIMEOUT
	);

	it(
		'用户代码运行时异常也归为 error',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'raise ValueError("boom")',
				tests: dummyTests
			});
			expect(result.outcome).toBe('error');
			expect(result.error).toContain('boom');
		},
		TIMEOUT
	);

	it(
		'捕获 print 输出',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'print("hello from python")',
				tests: dummyTests
			});
			expect(result.stdout).toContain('hello from python');
		},
		TIMEOUT
	);

	it(
		'逐条返回结果，部分失败时能看出通过了几条',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'x = 1',
				tests: [
					{ label: '第一条', code: 'assert x == 1' },
					{ label: '第二条', code: 'assert x == 2, "x 应该是 2"' },
					{ label: '第三条', code: 'assert x > 0' }
				]
			});
			expect(result.outcome).toBe('fail');
			expect(result.tests.map((t) => t.passed)).toEqual([true, false, true]);
			expect(result.tests[1].message).toBe('x 应该是 2');
		},
		TIMEOUT
	);

	it(
		'断言无自定义消息时给出可读的默认说明',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'y = 5',
				tests: [{ label: '无消息断言', code: 'assert y == 6' }]
			});
			expect(result.tests[0].message).toBe('断言不成立');
		},
		TIMEOUT
	);

	it(
		'测试用例内部的非断言异常被归类为该用例失败，而非整体 error',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'z = 1',
				tests: [{ label: '引用了不存在的名字', code: 'assert undefined_name == 1' }]
			});
			expect(result.outcome).toBe('fail');
			expect(result.tests[0].passed).toBe(false);
			expect(result.tests[0].message).toContain('NameError');
		},
		TIMEOUT
	);

	it(
		'setup 代码先于用户代码执行',
		async () => {
			const result = await executeCodeQuestion(py, {
				setupCode: 'PROVIDED = 42',
				userCode: 'doubled = PROVIDED * 2',
				tests: [{ label: '能用到 setup 提供的值', code: 'assert doubled == 84' }]
			});
			expect(result.correct).toBe(true);
		},
		TIMEOUT
	);

	it(
		'题干里的引号和换行不会破坏执行',
		async () => {
			const result = await executeCodeQuestion(py, {
				userCode: 'msg = "他说：\\"这样也行\\""',
				tests: [
					{
						label: '含引号的断言',
						code: 'assert "这样也行" in msg, f"实际是 {msg}"'
					}
				]
			});
			expect(result.correct).toBe(true);
		},
		TIMEOUT
	);
});
