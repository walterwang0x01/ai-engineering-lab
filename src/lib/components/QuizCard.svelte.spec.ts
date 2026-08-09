import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from '@vitest/browser/context';
import QuizCard from './QuizCard.svelte';
import type { ChoiceQuestion, NumericQuestion } from '$lib/quiz/types';

const numeric: NumericQuestion = {
	kind: 'numeric',
	id: 'n1',
	prompt: '32 个查询头分 8 组，节省几倍？',
	answer: 4,
	unit: '倍',
	hint: '这个比值只取决于两个数',
	explanation: '32 ÷ 8 = 4 倍'
};

const choice: ChoiceQuestion = {
	kind: 'choice',
	id: 'c1',
	prompt: 'MQA 的主要代价是什么？',
	options: ['显存更大', '质量下降', '延迟升高'],
	answerIndex: 1,
	distractorNotes: { 0: 'MQA 显存是最省的，方向反了' },
	explanation: '所有头共享一组 KV，表达能力受限'
};

describe('QuizCard 数值题', () => {
	it('渲染题干与单位', async () => {
		const screen = render(QuizCard, { question: numeric });
		await expect.element(screen.getByText(numeric.prompt)).toBeInTheDocument();
		// exact 避免与题干里的「几倍」冲突
		await expect.element(screen.getByText('倍', { exact: true })).toBeInTheDocument();
	});

	it('未输入时提交按钮禁用', async () => {
		const screen = render(QuizCard, { question: numeric });
		await expect.element(screen.getByRole('button', { name: '提交' })).toBeDisabled();
	});

	it('答对显示成功反馈与推导，并回调 true', async () => {
		const onResolved = vi.fn();
		const screen = render(QuizCard, { question: numeric, onResolved });

		await screen.getByLabelText('你的答案').fill('4');
		await screen.getByRole('button', { name: '提交' }).click();

		await expect.element(screen.getByText('答对了')).toBeInTheDocument();
		await expect.element(screen.getByText('32 ÷ 8 = 4 倍')).toBeInTheDocument();
		expect(onResolved).toHaveBeenCalledWith(true);
	});

	it('带单位的输入同样判对', async () => {
		const screen = render(QuizCard, { question: numeric });
		await screen.getByLabelText('你的答案').fill('4 倍');
		await screen.getByRole('button', { name: '提交' }).click();
		await expect.element(screen.getByText('答对了')).toBeInTheDocument();
	});

	it('第一次答错显示提示并允许重答，不立即回调', async () => {
		const onResolved = vi.fn();
		const screen = render(QuizCard, { question: numeric, onResolved });

		await screen.getByLabelText('你的答案').fill('8');
		await screen.getByRole('button', { name: '提交' }).click();

		await expect.element(screen.getByText('不对')).toBeInTheDocument();
		await expect.element(screen.getByText(/这个比值只取决于两个数/)).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: '再试一次' })).toBeInTheDocument();
		expect(onResolved).not.toHaveBeenCalled();
	});

	it('第二次答错公布正确答案并回调 false', async () => {
		const onResolved = vi.fn();
		const screen = render(QuizCard, { question: numeric, onResolved });
		const field = screen.getByLabelText('你的答案');

		await field.fill('8');
		await screen.getByRole('button', { name: '提交' }).click();
		await screen.getByRole('button', { name: '再试一次' }).click();
		await field.fill('16');
		await screen.getByRole('button', { name: '提交' }).click();

		await expect.element(screen.getByText(/正确答案/)).toBeInTheDocument();
		expect(onResolved).toHaveBeenCalledWith(false);
	});

	it('输入非数字给出针对性提示而非判错', async () => {
		const screen = render(QuizCard, { question: numeric });
		await screen.getByLabelText('你的答案').fill('不知道');
		await screen.getByRole('button', { name: '提交' }).click();
		await expect.element(screen.getByText(/这不像一个数字/)).toBeInTheDocument();
	});

	it('答对后输入框禁用，防止改答案', async () => {
		const screen = render(QuizCard, { question: numeric });
		await screen.getByLabelText('你的答案').fill('4');
		await screen.getByRole('button', { name: '提交' }).click();
		await expect.element(screen.getByLabelText('你的答案')).toBeDisabled();
	});

	it('容差内的答案标注为容差命中', async () => {
		const tol: NumericQuestion = {
			kind: 'numeric',
			id: 'n2',
			prompt: '显存约多少 GB？',
			answer: 40,
			tolerance: 1,
			explanation: '略'
		};
		const screen = render(QuizCard, { question: tol });
		await screen.getByLabelText('你的答案').fill('40.6');
		await screen.getByRole('button', { name: '提交' }).click();
		await expect.element(screen.getByText('对了（在容差范围内）')).toBeInTheDocument();
	});
});

describe('QuizCard 选择题', () => {
	it('渲染全部选项', async () => {
		const screen = render(QuizCard, { question: choice });
		for (const opt of choice.options) {
			await expect.element(screen.getByText(opt)).toBeInTheDocument();
		}
	});

	it('选对显示成功与解释', async () => {
		const onResolved = vi.fn();
		const screen = render(QuizCard, { question: choice, onResolved });

		await screen.getByText('质量下降').click();
		await screen.getByRole('button', { name: '提交' }).click();

		await expect.element(screen.getByText('答对了')).toBeInTheDocument();
		expect(onResolved).toHaveBeenCalledWith(true);
	});

	it('选错时展示针对该干扰项的定向说明', async () => {
		const screen = render(QuizCard, { question: choice });
		await screen.getByText('显存更大').click();
		await screen.getByRole('button', { name: '提交' }).click();
		await expect.element(screen.getByText(/MQA 显存是最省的/)).toBeInTheDocument();
	});

	it('未选择时提交按钮禁用', async () => {
		const screen = render(QuizCard, { question: choice });
		await expect.element(screen.getByRole('button', { name: '提交' })).toBeDisabled();
	});
});

describe('QuizCard 交互契约', () => {
	it('答对后点下一题触发回调', async () => {
		const onNext = vi.fn();
		const screen = render(QuizCard, { question: numeric, onNext });
		await screen.getByLabelText('你的答案').fill('4');
		await screen.getByRole('button', { name: '提交' }).click();
		await screen.getByRole('button', { name: '下一题 →' }).click();
		expect(onNext).toHaveBeenCalledOnce();
	});

	it('showNext 为 false 时不渲染下一题按钮', async () => {
		const screen = render(QuizCard, { question: numeric, showNext: false });
		await screen.getByLabelText('你的答案').fill('4');
		await screen.getByRole('button', { name: '提交' }).click();
		await expect.element(screen.getByText('答对了')).toBeInTheDocument();
		expect(screen.container.textContent).not.toContain('下一题');
	});

	it('回车键可提交（容器是 form，Enter 天然触发）', async () => {
		const screen = render(QuizCard, { question: numeric });
		const field = screen.getByLabelText('你的答案');
		await field.fill('4');
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByText('答对了')).toBeInTheDocument();
	});

	it('容器是 form 元素，保证键盘提交与无障碍语义', async () => {
		const screen = render(QuizCard, { question: numeric });
		expect(screen.container.querySelector('form')).not.toBeNull();
	});

	it('判定结果区域带 aria-live 以便读屏播报', async () => {
		const screen = render(QuizCard, { question: numeric });
		const live = screen.container.querySelector('[aria-live="polite"]');
		expect(live).not.toBeNull();
	});
});
