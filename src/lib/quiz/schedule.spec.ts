import { describe, expect, it } from 'vitest';
import {
	INTERVALS_DAYS,
	MAX_BOX,
	buildDueDeck,
	isDue,
	nextSchedule,
	summarizeMastery
} from './schedule';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe('nextSchedule', () => {
	it('新题答对升到 box 1，间隔 1 天', () => {
		const r = nextSchedule(0, true, NOW);
		expect(r.box).toBe(1);
		expect(r.dueAt).toBe(NOW + 1 * DAY);
	});

	it('连续答对逐级拉长间隔', () => {
		let state = { box: 0, dueAt: NOW };
		const boxes: number[] = [];
		for (let i = 0; i < 6; i++) {
			state = nextSchedule(state.box, true, NOW);
			boxes.push(state.box);
		}
		expect(boxes).toEqual([1, 2, 3, 4, 5, 5]);
	});

	it('达到最高等级后不再上升', () => {
		const r = nextSchedule(MAX_BOX, true, NOW);
		expect(r.box).toBe(MAX_BOX);
		expect(r.dueAt).toBe(NOW + INTERVALS_DAYS[MAX_BOX] * DAY);
	});

	it('答错直接归零且立即可再练', () => {
		const r = nextSchedule(4, false, NOW);
		expect(r.box).toBe(0);
		expect(r.dueAt).toBe(NOW);
	});

	it('容忍非法 box 输入', () => {
		expect(nextSchedule(-5, true, NOW).box).toBe(1);
		expect(nextSchedule(99, true, NOW).box).toBe(MAX_BOX);
		expect(nextSchedule(NaN, true, NOW).box).toBe(1);
		expect(nextSchedule(2.7, true, NOW).box).toBe(3);
	});
});

describe('isDue', () => {
	it('到期时间已过或恰好到点判为到期', () => {
		expect(isDue(NOW - 1, NOW)).toBe(true);
		expect(isDue(NOW, NOW)).toBe(true);
	});

	it('未到期返回 false', () => {
		expect(isDue(NOW + 1, NOW)).toBe(false);
	});
});

describe('buildDueDeck', () => {
	const ids = ['a', 'b', 'c', 'd'];

	it('全部为新题时按原顺序返回', () => {
		expect(buildDueDeck(ids, {}, NOW)).toEqual(ids);
	});

	it('新题排在到期旧题之前', () => {
		const records = {
			a: { box: 2, dueAt: NOW - DAY },
			b: { box: 1, dueAt: NOW - 2 * DAY }
		};
		expect(buildDueDeck(ids, records, NOW)).toEqual(['c', 'd', 'b', 'a']);
	});

	it('未到期的题不进入队列', () => {
		const records = {
			a: { box: 3, dueAt: NOW + 7 * DAY },
			b: { box: 3, dueAt: NOW + 7 * DAY },
			c: { box: 3, dueAt: NOW + 7 * DAY },
			d: { box: 3, dueAt: NOW + 7 * DAY }
		};
		expect(buildDueDeck(ids, records, NOW)).toEqual([]);
	});

	it('到期旧题按到期时间升序（越早到期越靠前）', () => {
		const records = {
			a: { box: 1, dueAt: NOW - DAY },
			b: { box: 1, dueAt: NOW - 3 * DAY },
			c: { box: 1, dueAt: NOW - 2 * DAY },
			d: { box: 1, dueAt: NOW + DAY }
		};
		expect(buildDueDeck(ids, records, NOW)).toEqual(['b', 'c', 'a']);
	});

	it('遵守数量上限', () => {
		const many = Array.from({ length: 50 }, (_, i) => `q${i}`);
		expect(buildDueDeck(many, {}, NOW)).toHaveLength(12);
		expect(buildDueDeck(many, {}, NOW, 5)).toHaveLength(5);
	});
});

describe('summarizeMastery', () => {
	it('正确分类四种状态', () => {
		const ids = ['new', 'learning', 'mastered', 'struggling'];
		const records = {
			learning: { box: 2, dueAt: NOW },
			mastered: { box: MAX_BOX, dueAt: NOW },
			struggling: { box: 0, dueAt: NOW }
		};
		expect(summarizeMastery(ids, records)).toEqual({
			total: 4,
			untouched: 1,
			learning: 1,
			mastered: 1,
			struggling: 1
		});
	});

	it('空记录时全部计为未接触', () => {
		const s = summarizeMastery(['a', 'b'], {});
		expect(s).toMatchObject({ total: 2, untouched: 2, learning: 0, mastered: 0, struggling: 0 });
	});

	it('各分类之和等于总数', () => {
		const ids = Array.from({ length: 20 }, (_, i) => `q${i}`);
		const records: Record<string, { box: number; dueAt: number }> = {};
		ids.forEach((id, i) => {
			if (i % 3 !== 0) records[id] = { box: i % (MAX_BOX + 1), dueAt: NOW };
		});
		const s = summarizeMastery(ids, records);
		expect(s.untouched + s.learning + s.mastered + s.struggling).toBe(s.total);
	});
});
