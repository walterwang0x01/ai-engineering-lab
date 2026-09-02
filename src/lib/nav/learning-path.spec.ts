import { describe, expect, it } from 'vitest';
import { LEARNING_PATH, PATH_COUNT, isOnPath } from './learning-path';

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
