import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MasteryLegend from './MasteryLegend.svelte';
import { INTERVALS_DAYS, MAX_BOX } from '$lib/quiz/schedule';

/**
 * 四档掌握度的解释。
 *
 * 零上下文复查里「我完全没看懂的东西」第一条：已掌握 / 在学 / 需重练 / 未做
 * 分散在三个位置出现，全站零解释，复查者只能做实验反推。
 *
 * 断言里刻意用 INTERVALS_DAYS 而不是写死「1、3、7、16、35」——
 * 文案必须跟着调度实现走，改了间隔而忘记改文案会被这里抓住。
 */

describe('四个状态都有解释', () => {
	it('逐个列出四档', () => {
		const screen = render(MasteryLegend);
		const terms = [...screen.container.querySelectorAll('dt')].map((d) => d.textContent?.trim());
		expect(terms).toEqual(['已掌握', '在学', '需重练', '未做']);
	});

	it('说明「需重练」是答错归零而不是退一档', () => {
		const screen = render(MasteryLegend);
		const text = screen.container.textContent ?? '';
		expect(text).toContain('归零');
		expect(text).toContain('答错');
	});

	it('间隔天数取自调度实现，不是写死的文案', () => {
		const screen = render(MasteryLegend);
		const text = screen.container.textContent ?? '';
		for (const d of INTERVALS_DAYS.slice(1)) {
			expect(text, `缺少间隔 ${d} 天`).toContain(String(d));
		}
		expect(text).toContain(String(MAX_BOX));
	});

	it('解释了「做完一轮后题目区为空」不是进度丢了', () => {
		const screen = render(MasteryLegend);
		expect(screen.container.textContent).toContain('不是进度丢了');
	});
});

describe('可访问性与默认收起', () => {
	it('用 details/summary，键盘与屏幕阅读器天然可用', () => {
		const screen = render(MasteryLegend);
		const details = screen.container.querySelector('details');
		expect(details).not.toBeNull();
		expect(details?.open).toBe(false);
		expect(screen.container.querySelector('summary')?.textContent).toContain('什么意思');
	});
});
