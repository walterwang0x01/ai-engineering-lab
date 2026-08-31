import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThinkingCard from './ThinkingCard.svelte';
import type { ChoiceQuestion } from '$lib/quiz/types';

const question: ChoiceQuestion = {
	kind: 'choice',
	id: 'c1',
	prompt: 'RAG 里块大小调大的直接后果是什么？',
	options: ['召回更准', '成本更高', '索引更小'],
	answerIndex: 1,
	hint: '想想一次召回要塞进多少 token',
	distractorNotes: {
		0: '块变大反而更容易掺进无关内容，召回是变松不是变准',
		2: '块越大块数越少，但每块更长，索引总量不降'
	},
	explanation: '块变大 → 单次召回的 token 变多 → 成本上升'
};

describe('ThinkingCard', () => {
	it('标注自己是未过审草稿', async () => {
		const screen = render(ThinkingCard, { question });
		await expect.element(screen.getByTestId('thinking-draft-note')).toBeInTheDocument();
	});

	/*
	 * 点的是选项文本而不是 radio 本身。
	 *
	 * radio 为了保留键盘与读屏可达性，用 1px + opacity:0 隐藏在 label 里，
	 * Playwright 会判定它「outside of the viewport」而拒绝点击。
	 * 点 label 内的文字走的是真实用户路径——人也点不到那个 radio。
	 */
	it('选一项就出解析，不需要先点提交', async () => {
		const screen = render(ThinkingCard, { question });
		await screen.getByText('成本更高').click();
		await expect.element(screen.getByTestId('thinking-verdict')).toBeInTheDocument();
	});

	it('选中正确项时说「一致」，不说「答对」', async () => {
		const screen = render(ThinkingCard, { question });
		await screen.getByText('成本更高').click();
		await expect.element(screen.getByText('和这篇给的答案一致')).toBeInTheDocument();
	});

	it('选中干扰项时给出该项的定向解析，措辞避开「错」', async () => {
		const screen = render(ThinkingCard, { question });
		await screen.getByText('召回更准').click();

		await expect.element(screen.getByText('你选的不是这一篇给的答案')).toBeInTheDocument();
		await expect.element(screen.getByText(/块变大反而更容易掺进无关内容/)).toBeInTheDocument();
	});

	it('揭示后改点别的选项，干扰项解析跟着换', async () => {
		const screen = render(ThinkingCard, { question });
		await screen.getByText('召回更准').click();
		await expect.element(screen.getByText(/块变大反而更容易掺进无关内容/)).toBeInTheDocument();

		await screen.getByText('索引更小').click();
		await expect.element(screen.getByText(/块越大块数越少/)).toBeInTheDocument();
	});

	it('提示可以展开和收起', async () => {
		const screen = render(ThinkingCard, { question });
		await screen.getByRole('button', { name: '给点提示' }).click();
		await expect.element(screen.getByText(/一次召回要塞进多少 token/)).toBeInTheDocument();

		await screen.getByRole('button', { name: '收起提示' }).click();
		await expect.element(screen.getByRole('button', { name: '给点提示' })).toBeInTheDocument();
	});

	it('onReveal 只在第一次揭示时触发一次', async () => {
		const onReveal = vi.fn();
		const screen = render(ThinkingCard, { question, onReveal });

		await screen.getByText('召回更准').click();
		await screen.getByText('索引更小').click();

		expect(onReveal).toHaveBeenCalledTimes(1);
	});

	it('再想想把卡片退回未揭示状态', async () => {
		const screen = render(ThinkingCard, { question });
		await screen.getByText('召回更准').click();
		await expect.element(screen.getByTestId('thinking-verdict')).toBeInTheDocument();

		await screen.getByRole('button', { name: '再想想' }).click();
		await expect.element(screen.getByTestId('thinking-verdict')).not.toBeInTheDocument();
	});

	it('下一题按钮调用 onNext', async () => {
		const onNext = vi.fn();
		const screen = render(ThinkingCard, { question, onNext });

		await screen.getByText('成本更高').click();
		await screen.getByRole('button', { name: '下一题 →' }).click();

		expect(onNext).toHaveBeenCalledTimes(1);
	});
});
