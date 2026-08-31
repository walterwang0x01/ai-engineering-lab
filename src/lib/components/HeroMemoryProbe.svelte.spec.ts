import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HeroMemoryProbe from './HeroMemoryProbe.svelte';

/**
 * 首屏探针的数值门禁。
 *
 * 这个部件的数字**必须**和题库对得上：它算的就是 `kv-cache-questions.ts` 与
 * `deploy-decision-questions.ts` 里考的那条 KV Cache 公式。首页上算出 41 GB、
 * 题目里答案是 40 GB，读者会以为自己算错——所以这里逐档钉住已知答案，
 * 而不只是断言「渲染出来了」。
 *
 * 公式：2(K和V) × batch × seq × layers × kv_heads × head_dim × 每元素字节
 * GQA 下 kv_heads = 组数 = 8，不是 64 个查询头（最常见的算错点）。
 */

/** 拖滑块。range 输入用 fill 设值，与 KvCacheSandbox 的点选式交互不同 */
async function setRange(
	screen: ReturnType<typeof render>,
	testId: string,
	value: string
): Promise<void> {
	await screen.getByTestId(testId).fill(value);
}

describe('HeroMemoryProbe 默认状态', () => {
	it('batch 32 / 4K / fp16 → KV 40.0 GiB，与题库 deploy-decision-01 一致', async () => {
		const screen = render(HeroMemoryProbe);
		expect(screen.getByTestId('probe-kv').element().textContent).toBe('40.0');
	});

	it('总需求 = 权重 130.4 + KV 40 = 170 GiB，与题库 Q2 的 170.4 同源', async () => {
		const screen = render(HeroMemoryProbe);
		// fmt() 对 ≥100 的数取整，所以显示 170 而不是 170.4
		expect(screen.getByTestId('probe-total').element().textContent).toBe('170');
	});

	it('默认配置放得下，且给出余量', async () => {
		const screen = render(HeroMemoryProbe);
		await expect.element(screen.getByText(/放得下/)).toBeInTheDocument();
	});
});

describe('HeroMemoryProbe 量化的影响', () => {
	it('切到 INT8 让 KV 减半到 20.0 GiB（题库 Q5 同值）', async () => {
		const screen = render(HeroMemoryProbe);
		await screen.getByText('INT8', { exact: true }).click();
		/*
		 * click() 只保证浏览器事件完成，不保证 Svelte 的 `$derived` 已经 flush 到 DOM。
		 * 原来下一行同步读 textContent：共享 Chromium 空闲时碰巧读到 20.0，忙时读到
		 * 旧的 40.0。连续 5 轮完整测试里前 4 轮绿、第 5 轮稳定复现这两条失败。
		 *
		 * expect.element 会重试**用户可见结果**，不是 sleep；若响应式真的坏了，
		 * 15 秒后仍会如实失败。
		 */
		await expect.element(screen.getByTestId('probe-kv')).toHaveTextContent('20.0');
	});

	it('切到 INT4 再减半到 10.0 GiB', async () => {
		const screen = render(HeroMemoryProbe);
		await screen.getByText('INT4', { exact: true }).click();
		await expect.element(screen.getByTestId('probe-kv')).toHaveTextContent('10.0');
	});
});

describe('HeroMemoryProbe 线性关系', () => {
	it('batch 减半到 16 → KV 减半到 20.0 GiB（题库 Q7 同值）', async () => {
		const screen = render(HeroMemoryProbe);
		await setRange(screen, 'probe-batch', '16');
		await expect.element(screen.getByTestId('probe-kv')).toHaveTextContent('20.0');
	});

	it('上下文翻倍到 8K → KV 翻倍到 80.0 GiB', async () => {
		const screen = render(HeroMemoryProbe);
		await setRange(screen, 'probe-context', '1');
		await expect.element(screen.getByTestId('probe-kv')).toHaveTextContent('80.0');
	});
});

describe('HeroMemoryProbe 约束被打破', () => {
	/**
	 * 这条是整个部件存在的理由：长上下文对显存是**线性**放大，
	 * 而直觉常以为「长一点没多少」。128K 上下文下 8 卡节点必然装不下。
	 */
	it('128K 上下文越过 640 GiB 容量，判定翻转为放不下', async () => {
		const screen = render(HeroMemoryProbe);
		await setRange(screen, 'probe-context', '5');
		await expect.element(screen.getByText(/放不下/)).toBeInTheDocument();
	});

	it('放不下时给出可操作的出路，而不只是报错', async () => {
		const screen = render(HeroMemoryProbe);
		await setRange(screen, 'probe-context', '5');
		await expect.element(screen.getByText(/砍 batch、缩上下文或量化 KV/)).toBeInTheDocument();
	});
});
