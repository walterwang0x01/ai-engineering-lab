import { describe, expect, it } from 'vitest';
import { SolvedLatch, allSatisfied, barPct } from './constraints';

/**
 * 达标型沙盒共享逻辑的门禁。
 *
 * 抽取之前，这个百分比计算在三个沙盒里各写了一遍
 * （`Math.min(100, (value / budget) * 100)`），三份都没处理 budget 为 0 的情形——
 * 那会算出 Infinity 并进到 `style="width: Infinity%"`。
 * 统一之后在这里一次性把边界补齐。
 */

describe('barPct', () => {
	it('按预算给出百分比', () => {
		expect(barPct(20, 40)).toBe(50);
		expect(barPct(40, 40)).toBe(100);
	});

	it('超预算时封顶在 100，不撑破容器', () => {
		expect(barPct(320, 45)).toBe(100);
	});

	it('负值夹到 0', () => {
		expect(barPct(-5, 45)).toBe(0);
	});

	it('预算为 0 或负数时返回 0，而不是 Infinity', () => {
		expect(barPct(10, 0)).toBe(0);
		expect(barPct(10, -1)).toBe(0);
	});

	it('非有限数不会渗进样式', () => {
		expect(barPct(Number.NaN, 45)).toBe(0);
		expect(barPct(Number.POSITIVE_INFINITY, 45)).toBe(0);
		expect(barPct(10, Number.NaN)).toBe(0);
	});
});

describe('allSatisfied', () => {
	it('全部为真才达标', () => {
		expect(allSatisfied([true, true])).toBe(true);
		expect(allSatisfied([true, false])).toBe(false);
		expect(allSatisfied([false, false, false])).toBe(false);
	});

	it('空约束列表判为未达标，而不是沿用 every 的真空真', () => {
		expect(allSatisfied([])).toBe(false);
	});
});

describe('SolvedLatch', () => {
	it('首次达标时点亮一次，之后不再重复点亮', () => {
		const latch = new SolvedLatch();
		expect(latch.observe(false)).toBe(false);
		expect(latch.observe(true)).toBe(true);
		expect(latch.observe(true)).toBe(false);
	});

	it('达标过之后再调坏也不熄灭 —— 它记录事件，不是当前状态', () => {
		const latch = new SolvedLatch();
		latch.observe(true);
		latch.observe(false);
		expect(latch.latched).toBe(true);
	});
});
