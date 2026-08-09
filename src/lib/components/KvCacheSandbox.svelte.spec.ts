import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import KvCacheSandbox from './KvCacheSandbox.svelte';

/** 选中一组配置 */
async function configure(
	screen: ReturnType<typeof render>,
	attn: string,
	prec: string
): Promise<void> {
	await screen.getByText(attn, { exact: true }).click();
	await screen.getByText(prec, { exact: true }).click();
}

describe('KvCacheSandbox 初始状态', () => {
	it('默认为 MHA + fp16，显存 320 GB 且超预算', async () => {
		const screen = render(KvCacheSandbox);
		expect(screen.getByTestId('memory-value').element().textContent).toBe('320 GB');
		await expect.element(screen.getByText(/显存超了|两个约束都没满足/)).toBeInTheDocument();
	});

	it('展示关卡的双重约束', async () => {
		const screen = render(KvCacheSandbox);
		await expect.element(screen.getByText(/KV Cache < 45 GB/)).toBeInTheDocument();
		await expect.element(screen.getByText(/质量损失 < 2%/)).toBeInTheDocument();
	});
});

describe('KvCacheSandbox 显存计算', () => {
	it('GQA 8 组 + fp16 得 40 GB', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 8', 'fp16');
		expect(screen.getByTestId('memory-value').element().textContent).toBe('40.0 GB');
	});

	it('GQA 8 组 + int8 得 20 GB', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 8', 'int8');
		expect(screen.getByTestId('memory-value').element().textContent).toBe('20.0 GB');
	});

	it('MQA + int4 显存最省', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'MQA', 'int4');
		expect(screen.getByTestId('memory-value').element().textContent).toBe('1.25 GB');
	});
});

describe('KvCacheSandbox 达标判定', () => {
	it('GQA 8 + int8 达标并触发回调', async () => {
		const onSolved = vi.fn();
		const screen = render(KvCacheSandbox, { onSolved });
		await configure(screen, 'GQA 8', 'int8');
		await expect.element(screen.getByText(/达标。这个配置可以上生产/)).toBeInTheDocument();
		expect(onSolved).toHaveBeenCalledOnce();
	});

	it('GQA 8 + fp16 也是可行解', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 8', 'fp16');
		await expect.element(screen.getByText(/达标/)).toBeInTheDocument();
	});

	it('GQA 16 + int8 也是可行解', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 16', 'int8');
		await expect.element(screen.getByText(/达标/)).toBeInTheDocument();
	});

	it('MQA 虽然最省显存但质量超标，无法通关', async () => {
		const onSolved = vi.fn();
		const screen = render(KvCacheSandbox, { onSolved });
		await configure(screen, 'MQA', 'fp16');
		await expect.element(screen.getByText(/质量损失超标/)).toBeInTheDocument();
		expect(onSolved).not.toHaveBeenCalled();
	});

	it('MHA + int4 两个约束都不满足', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'MHA', 'int4');
		await expect.element(screen.getByText(/两个约束都没满足/)).toBeInTheDocument();
	});

	it('GQA 16 + fp16 显存超标', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 16', 'fp16');
		expect(screen.getByTestId('memory-value').element().textContent).toBe('80.0 GB');
		await expect.element(screen.getByText(/显存超了/)).toBeInTheDocument();
	});

	it('达标回调只触发一次，即使继续切换配置', async () => {
		const onSolved = vi.fn();
		const screen = render(KvCacheSandbox, { onSolved });
		await configure(screen, 'GQA 8', 'int8');
		await configure(screen, 'GQA 8', 'fp16');
		await configure(screen, 'GQA 16', 'int8');
		expect(onSolved).toHaveBeenCalledOnce();
	});
});

describe('KvCacheSandbox 教学信息', () => {
	it('展示公式推导，含当前的 kv_heads 与字节数', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 8', 'int8');
		await expect.element(screen.getByText(/2 × 32 × 4096 × 80/)).toBeInTheDocument();
	});

	it('展示相对 MHA fp16 基线的节省倍数', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'GQA 8', 'int8');
		// 320 / 20 = 16
		await expect.element(screen.getByText(/16\.0×/)).toBeInTheDocument();
	});

	it('明确标注质量损失是估算值', async () => {
		const screen = render(KvCacheSandbox);
		await expect.element(screen.getByText(/示意性估算/)).toBeInTheDocument();
	});

	it('未达标时给出方向性引导而非直接给答案', async () => {
		const screen = render(KvCacheSandbox);
		await configure(screen, 'MQA', 'int4');
		const text = screen.container.textContent ?? '';
		expect(text).not.toContain('正确答案');
	});
});
