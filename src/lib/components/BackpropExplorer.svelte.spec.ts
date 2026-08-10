import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BackpropExplorer from './BackpropExplorer.svelte';

/**
 * 观察型演示的状态一致性门禁。
 *
 * 零上下文可用性复查抓到一条严重度 3：h2 存活时，屏幕上同时显示
 * `∂L/∂w21 = -32.550`（非零、绿色）和「必然全部归零」这句固定文案。
 * 复查者的原话是「到底该信数字还是信文字」，停下来想了远超 5 秒。
 *
 * 所以这里断言的不是文案措辞，而是**文字不能和它正上方的数字矛盾**。
 */

/** 把滑块拖到某个值。x1 是这个演示唯一的可调输入 */
async function setX1(screen: ReturnType<typeof render>, value: number) {
	const slider = screen.container.querySelector('input[type=range]') as HTMLInputElement;
	slider.value = String(value);
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	await new Promise((r) => setTimeout(r, 30));
}

describe('h2 死亡时（默认状态）', () => {
	it('梯度显示为 0，说明文字讲归零', async () => {
		const screen = render(BackpropExplorer);
		expect(screen.getByTestId('relu-grad-z2').element().textContent?.trim()).toBe('0');
		const note = screen.getByTestId('chain-upstream').element().textContent ?? '';
		expect(note).toContain('必然全部归零');
	});
});

describe('h2 存活时（x1 拖过临界点 2.33）', () => {
	it('ReLU 导数变成 1', async () => {
		const screen = render(BackpropExplorer);
		await setX1(screen, 3.5);
		expect(screen.getByTestId('relu-grad-z2').element().textContent?.trim()).toBe('1');
	});

	it('说明文字不再声称梯度归零 —— 这是那条矛盾的核心', async () => {
		const screen = render(BackpropExplorer);
		await setX1(screen, 3.5);
		const note = screen.getByTestId('chain-upstream').element().textContent ?? '';
		expect(note).not.toContain('必然全部归零');
		expect(note).toContain('还在学');
	});

	it('文字与屏幕上的梯度数值方向一致', async () => {
		const screen = render(BackpropExplorer);
		await setX1(screen, 3.5);
		const grads = [...screen.container.querySelectorAll('.chain-value')]
			.map((n) => n.textContent?.trim() ?? '')
			.filter((t) => t.includes('.'));
		// 存活时至少有一个非零梯度显示在屏幕上
		expect(grads.some((t) => parseFloat(t) !== 0)).toBe(true);
	});
});
