import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InteractionHost from './InteractionHost.svelte';
import type { InteractionSpec } from './types';

function spec(
	evaluate: InteractionSpec['evaluate'] = vi.fn((v: Readonly<Record<string, number>>) => ({
		metrics: [{ label: '结果', value: v.x * 2, digits: 0 }],
		bars: [{ label: '占用', value: v.x, max: 10, valueLabel: `${v.x}/10` }],
		conclusion: v.x > 7 ? '超过建议区间，需要降低输入值。' : '当前输入仍在建议区间内。',
		tone: v.x > 7 ? ('warn' as const) : ('ok' as const)
	}))
): InteractionSpec {
	return {
		id: 'demo-interaction',
		type: 'formula',
		title: '演示实验',
		description: '用于验证统一渲染器行为。',
		parameters: [{ id: 'x', label: '输入 X', min: 0, max: 10, step: 1, defaultValue: 3 }],
		presets: [{ id: 'high', label: '高值预设', values: { x: 9 } }],
		evaluate
	};
}

describe('InteractionHost 声明式渲染', () => {
	it('渲染参数、指标、约束条与结论', async () => {
		const screen = render(InteractionHost, { spec: spec() });
		await expect.element(screen.getByText('演示实验')).toBeInTheDocument();
		await expect.element(screen.getByRole('slider', { name: '输入 X' })).toHaveValue('3');
		await expect.element(screen.getByText('6', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText(/当前输入仍在建议区间/)).toBeInTheDocument();
	});

	it('拖动参数后 evaluate 接收新值并更新用户可见结果', async () => {
		const evaluate = vi.fn((v: Readonly<Record<string, number>>) => ({
			metrics: [{ label: '结果', value: v.x * 2 }],
			conclusion: `当前是 ${v.x}`,
			tone: 'neutral' as const
		}));
		const screen = render(InteractionHost, { spec: spec(evaluate) });
		await screen.getByRole('slider', { name: '输入 X' }).fill('7');
		await expect.element(screen.getByText('当前是 7')).toBeInTheDocument();
		expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ x: 7 }));
	});

	it('预设只覆盖声明的参数，重置恢复默认值', async () => {
		const screen = render(InteractionHost, { spec: spec() });
		await screen.getByText('高值预设', { exact: true }).click();
		await expect.element(screen.getByRole('slider', { name: '输入 X' })).toHaveValue('9');
		await expect.element(screen.getByText(/超过建议区间/)).toBeInTheDocument();
		await screen.getByRole('button', { name: '重置' }).click();
		await expect.element(screen.getByRole('slider', { name: '输入 X' })).toHaveValue('3');
	});

	it('默认状态下重置禁用，避免无意义操作', async () => {
		const screen = render(InteractionHost, { spec: spec() });
		await expect.element(screen.getByRole('button', { name: '重置' })).toBeDisabled();
	});
});
