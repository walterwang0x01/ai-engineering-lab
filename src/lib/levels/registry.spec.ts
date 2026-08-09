import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { LEVELS, LEVEL_IDS, getLevel } from './registry';
import { assertValidQuestionSet } from '$lib/quiz/validate';

/**
 * 注册表是路由、首页卡片、预渲染路径的唯一数据源，
 * 所以它的结构约束必须是门禁，不能靠自觉。
 *
 * 新增关卡时这个文件会自动覆盖到——不需要为新关卡额外写结构测试。
 */

describe('注册表结构', () => {
	it('至少有一个关卡', () => {
		expect(LEVELS.length).toBeGreaterThan(0);
	});

	it('关卡 id 唯一', () => {
		expect(new Set(LEVEL_IDS).size).toBe(LEVEL_IDS.length);
	});

	it('关卡 id 是合法的 URL 片段', () => {
		for (const id of LEVEL_IDS) {
			expect(id, `${id} 含不适合放进 URL 的字符`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});

	it('getLevel 能按 id 取到，未知 id 返回 undefined', () => {
		for (const id of LEVEL_IDS) {
			expect(getLevel(id)?.id).toBe(id);
		}
		expect(getLevel('no-such-level')).toBeUndefined();
	});

	it('每个关卡的必填文案都非空', () => {
		for (const l of LEVELS) {
			expect(l.title.trim(), `${l.id} 缺 title`).not.toBe('');
			expect(l.eyebrow.trim(), `${l.id} 缺 eyebrow`).not.toBe('');
			expect(l.lede.trim(), `${l.id} 缺 lede`).not.toBe('');
			expect(l.card.tag.trim(), `${l.id} 缺 card.tag`).not.toBe('');
			expect(l.card.summary.trim(), `${l.id} 缺 card.summary`).not.toBe('');
			expect(l.card.points.length, `${l.id} 的 card.points 应有 2-4 条`).toBeGreaterThanOrEqual(2);
			expect(l.card.points.length).toBeLessThanOrEqual(4);
			expect(l.seo.title.trim(), `${l.id} 缺 seo.title`).not.toBe('');
			expect(l.seo.description.trim(), `${l.id} 缺 seo.description`).not.toBe('');
		}
	});
});

describe('题库与关卡的一致性', () => {
	it('每个关卡的题库都通过共享校验（含 id 前缀隔离）', () => {
		for (const l of LEVELS) {
			expect(() => assertValidQuestionSet(l.questions, l.id), `${l.id} 题库不合规`).not.toThrow();
		}
	});

	it('题目 id 全站唯一（跨关卡不撞车）', () => {
		const all = LEVELS.flatMap((l) => l.questions.map((q) => q.id));
		const dupes = all.filter((id, i) => all.indexOf(id) !== i);
		expect(dupes, `重复的题目 id 会让进度互相覆盖：${dupes.join(', ')}`).toEqual([]);
	});

	it('每个关卡题量在 8-14 之间', () => {
		for (const l of LEVELS) {
			expect(
				l.questions.length,
				`${l.id} 题量 ${l.questions.length} 超出建议范围`
			).toBeGreaterThanOrEqual(8);
			expect(l.questions.length).toBeLessThanOrEqual(14);
		}
	});

	it('每个关卡的题型有搭配，不是清一色', () => {
		for (const l of LEVELS) {
			const kinds = new Set(l.questions.map((q) => q.kind));
			expect(kinds.size, `${l.id} 只有一种题型`).toBeGreaterThan(1);
		}
	});
});

describe('OG 图与资源', () => {
	it('每个关卡引用的 OG 图都真实存在', () => {
		for (const l of LEVELS) {
			const path = `static/og/${l.seo.ogImage}`;
			expect(existsSync(path), `${l.id} 引用的 ${path} 不存在，跑 pnpm run og`).toBe(true);
		}
	});

	it('OG 图文件名各不相同（避免复用同一张图）', () => {
		const images = LEVELS.map((l) => l.seo.ogImage);
		expect(new Set(images).size).toBe(images.length);
	});
});

describe('交互组件', () => {
	it('声明了交互的关卡，其加载函数可调用且导出默认组件', async () => {
		for (const l of LEVELS) {
			if (!l.interactive) continue;
			expect(l.interactive.heading.trim(), `${l.id} 交互区缺 heading`).not.toBe('');
			expect(l.interactive.note.trim(), `${l.id} 交互区缺 note`).not.toBe('');
			const mod = await l.interactive.load();
			expect(mod.default, `${l.id} 的交互组件没有默认导出`).toBeTruthy();
		}
	});
});
