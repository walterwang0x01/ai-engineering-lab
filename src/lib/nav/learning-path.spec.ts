import { describe, expect, it } from 'vitest';
import {
	LEARNING_PATH,
	PATH_COUNT,
	isOnPath,
	pathPosition,
	type StepStatus
} from './learning-path';

/**
 * 学习路线数据本身的一致性。
 *
 * 这份数据是手写的——如果某天改了笔记 slug 但忘了更新路线，
 * 笔记页的路线视图就会出现死链。所以这里守住：
 * - slug 在路线内不重复
 * - prerequisites 引用的 slug 都在路线上存在
 * - order 在每个阶段内从 1 开始连续递增
 * - 总数与 PATH_COUNT 一致
 *
 * 注意：这里验不了「slug 在 manifest 里真实存在」——manifest 是构建期产物，
 * 单元测试跑的时候 static/notes/manifest.json 可能还没生成。
 * 那一层由 build 后的 smoke test 兜底（e2e/smoke.mjs 会 fetch 路线上的笔记 URL）。
 */

const allSlugs = LEARNING_PATH.flatMap((s) => s.steps.map((p) => p.slug));

describe('学习路线数据一致性', () => {
	it('slug 在路线内不重复', () => {
		const seen = new Set<string>();
		const dupes: string[] = [];
		for (const slug of allSlugs) {
			if (seen.has(slug)) dupes.push(slug);
			seen.add(slug);
		}
		expect(dupes, `重复的 slug: ${dupes.join(', ')}`).toEqual([]);
	});

	it('PATH_COUNT 与实际 step 数一致', () => {
		expect(PATH_COUNT).toBe(allSlugs.length);
	});

	it('isOnPath 对路线上的 slug 返回 true，不在的返回 false', () => {
		expect(isOnPath(allSlugs[0])).toBe(true);
		expect(isOnPath('not/a/real/note')).toBe(false);
	});

	it('每个阶段的 order 从 1 开始连续递增', () => {
		for (const stage of LEARNING_PATH) {
			const orders = stage.steps.map((s) => s.order);
			const expected = Array.from({ length: stage.steps.length }, (_, i) => i + 1);
			expect(orders, `阶段「${stage.title}」的 order 不连续`).toEqual(expected);
		}
	});

	it('所有 prerequisites 引用的 slug 都在路线上', () => {
		const pathSet = new Set(allSlugs);
		const dangling: string[] = [];
		for (const stage of LEARNING_PATH) {
			for (const step of stage.steps) {
				for (const prereq of step.prerequisites) {
					if (!pathSet.has(prereq)) dangling.push(`${step.slug} -> ${prereq}`);
				}
			}
		}
		expect(dangling, `悬空的前置引用: ${dangling.join(', ')}`).toEqual([]);
	});

	it('每篇 step 都有 tier 标注', () => {
		const validTiers = new Set(['required', 'optional', 'on-demand']);
		const missing: string[] = [];
		for (const stage of LEARNING_PATH) {
			for (const step of stage.steps) {
				if (!validTiers.has(step.tier)) missing.push(step.slug);
			}
		}
		expect(missing, `tier 无效的 step: ${missing.join(', ')}`).toEqual([]);
	});

	it('路线分 5 个阶段，顺序从 0 开始', () => {
		expect(LEARNING_PATH.map((s) => s.id)).toEqual([0, 1, 2, 3, 4]);
	});
});

/**
 * 断点续读的定位逻辑。
 *
 * 这里守住的是两个**容易被"优化"掉**的决定：
 *   1. `started`（动过但没收尾）不算走过，「下一步」要指回它；
 *   2. 扫描按 order 走，不依赖数组书写顺序恰好等于 order。
 *
 * 用 `statusOf` 注入状态，所以完全不碰 localStorage 和 runes。
 */
describe('路线位置（断点续读）', () => {
	/** 按路线真实顺序（阶段 → 阶段内 order）铺平的 slug 序列 */
	const ordered = LEARNING_PATH.flatMap((stage) =>
		[...stage.steps].sort((a, b) => a.order - b.order).map((s) => s.slug)
	);

	/** 除了 overrides 里指定的，其余都按 fallback 处理 */
	function statusFrom(
		overrides: Record<string, StepStatus>,
		fallback: StepStatus = 'untouched'
	): (slug: string) => StepStatus {
		return (slug) => overrides[slug] ?? fallback;
	}

	it('全新用户：下一步是路线的第一篇，且标记为 fresh', () => {
		const pos = pathPosition(statusFrom({}));
		expect(pos.next?.step.slug).toBe(ordered[0]);
		expect(pos.next?.stage.id).toBe(LEARNING_PATH[0].id);
		expect(pos.doneCount).toBe(0);
		expect(pos.fresh).toBe(true);
		expect(pos.resuming).toBe(false);
	});

	it('total 恒等于 PATH_COUNT', () => {
		expect(pathPosition(statusFrom({})).total).toBe(PATH_COUNT);
	});

	it('全部收尾：next 为 null，doneCount 等于总数', () => {
		const pos = pathPosition(statusFrom({}, 'done'));
		expect(pos.next).toBeNull();
		expect(pos.doneCount).toBe(PATH_COUNT);
		expect(pos.fresh).toBe(false);
	});

	it('跳过已收尾的，指向第一篇没收尾的', () => {
		const pos = pathPosition(statusFrom({ [ordered[0]]: 'done', [ordered[1]]: 'done' }));
		expect(pos.next?.step.slug).toBe(ordered[2]);
		expect(pos.doneCount).toBe(2);
		expect(pos.fresh).toBe(false);
	});

	it('题做了一半的那篇不算走过——下一步指回它，并标记 resuming', () => {
		// 这是断点续读的全部意义：人送回上次停下的地方，而不是推去下一篇
		const pos = pathPosition(statusFrom({ [ordered[0]]: 'done', [ordered[1]]: 'started' }));
		expect(pos.next?.step.slug).toBe(ordered[1]);
		expect(pos.resuming).toBe(true);
		// started 不计入 doneCount，否则进度条会虚报
		expect(pos.doneCount).toBe(1);
	});

	it('更靠前的未读优先于更靠后的半成品（不倒着找断点）', () => {
		const pos = pathPosition(statusFrom({ [ordered[3]]: 'started' }));
		expect(pos.next?.step.slug).toBe(ordered[0]);
		expect(pos.resuming).toBe(false);
	});

	it('只碰过一篇也不再算 fresh（文案要说「继续」而不是「开始」）', () => {
		expect(pathPosition(statusFrom({ [ordered[0]]: 'started' })).fresh).toBe(false);
	});

	it('定位不依赖 steps 的书写顺序，只认 order', () => {
		// 找一个 steps 数组顺序与 order 不同的场景：把第一阶段除 order:1 之外的全设为 done，
		// 那么 next 必须是 order:1 的那篇，无论它写在数组第几位
		const first = LEARNING_PATH[0];
		const firstByOrder = [...first.steps].sort((a, b) => a.order - b.order)[0];
		const done: Record<string, StepStatus> = {};
		for (const s of first.steps) {
			if (s.slug !== firstByOrder.slug) done[s.slug] = 'done';
		}
		const pos = pathPosition(statusFrom(done));
		expect(pos.next?.step.slug).toBe(firstByOrder.slug);
		expect(pos.next?.step.order).toBe(1);
	});
});
