import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CodeQuestionCard from './CodeQuestionCard.svelte';
import type { CodeQuestion } from '$lib/quiz/types';

/**
 * 这里只测不依赖 Pyodide 的行为：渲染、控件状态、提示文案。
 *
 * 实际的 Python 执行与判定由 src/lib/python/solutions.spec.ts 覆盖——
 * 它在 Node 下用本地 WASM 跑真实 Pyodide，比在浏览器里等 CDN 下载
 * 10MB 更快也更可靠。
 */

const question: CodeQuestion = {
	kind: 'code',
	id: 'demo-c1-sum',
	prompt: '实现一个求和函数。',
	starterCode: 'def total(xs):\n    raise NotImplementedError("请实现")\n',
	solutionCode: 'def total(xs):\n    return sum(xs)\n',
	tests: [
		{ label: '空列表为 0', code: 'assert total([]) == 0' },
		{ label: '正数求和', code: 'assert total([1, 2, 3]) == 6' }
	],
	hint: '标准库的 sum 就够了',
	explanation: '直接用 sum 即可。\n\n第二段说明。'
};

const withSetup: CodeQuestion = {
	...question,
	id: 'demo-c2-setup',
	setupCode: 'PROVIDED = [1, 2, 3]\n'
};

describe('CodeQuestionCard 渲染', () => {
	it('显示题干', async () => {
		const screen = render(CodeQuestionCard, { question });
		await expect.element(screen.getByText('实现一个求和函数。')).toBeInTheDocument();
	});

	it('提供运行与重置按钮', async () => {
		const screen = render(CodeQuestionCard, { question });
		await expect.element(screen.getByRole('button', { name: '运行并检查' })).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: '重置' })).toBeInTheDocument();
	});

	it('首次运行前说明会下载运行时且代码不上传', async () => {
		const screen = render(CodeQuestionCard, { question });
		await expect.element(screen.getByText(/首次运行需要下载约 10 MB/)).toBeInTheDocument();
		await expect.element(screen.getByText(/不会上传到任何服务器/)).toBeInTheDocument();
	});

	it('存在编辑器挂载点', async () => {
		const screen = render(CodeQuestionCard, { question });
		await expect.element(screen.getByTestId('code-editor')).toBeInTheDocument();
	});

	it('有 setup 代码时展示只读折叠面板', async () => {
		const screen = render(CodeQuestionCard, { question: withSetup });
		await expect.element(screen.getByText(/已为你准备好的代码/)).toBeInTheDocument();
		await expect.element(screen.getByText('PROVIDED = [1, 2, 3]')).toBeInTheDocument();
	});

	it('没有 setup 代码时不显示该面板', async () => {
		const screen = render(CodeQuestionCard, { question });
		expect(screen.container.textContent).not.toContain('已为你准备好的代码');
	});

	it('初始不显示提示与解释', async () => {
		const screen = render(CodeQuestionCard, { question });
		const text = screen.container.textContent ?? '';
		expect(text).not.toContain('标准库的 sum 就够了');
		expect(text).not.toContain('直接用 sum 即可');
	});

	it('初始不显示参考答案', async () => {
		const screen = render(CodeQuestionCard, { question });
		expect(screen.container.textContent).not.toContain('return sum(xs)');
	});

	it('未尝试前不提供「看参考答案」', async () => {
		const screen = render(CodeQuestionCard, { question });
		expect(screen.container.textContent).not.toContain('看参考答案');
	});

	it('反馈区带 aria-live 以便读屏播报异步结果', async () => {
		const screen = render(CodeQuestionCard, { question });
		const live = screen.container.querySelector('[aria-live="polite"]');
		expect(live).not.toBeNull();
	});

	it('卡片初始状态为 idle', async () => {
		const screen = render(CodeQuestionCard, { question });
		const card = screen.container.querySelector('.card');
		expect(card?.getAttribute('data-state')).toBe('idle');
	});
});

describe('CodeQuestionCard 题目数据契约', () => {
	it('起始代码抛 NotImplementedError 而非返回定值', () => {
		// 这条守的是 AGENTS.md 硬约定：return 0 会让比较型断言恒真
		expect(question.starterCode).toContain('NotImplementedError');
	});

	it('每条测试用例都含 assert', () => {
		for (const t of question.tests) {
			expect(t.code, `用例「${t.label}」不含 assert，会恒真`).toContain('assert');
		}
	});
});
