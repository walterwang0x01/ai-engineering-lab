import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LearningPath from './LearningPath.svelte';
import { EMPTY_MANIFEST, buildCurriculum } from '$lib/curriculum/build';
import { LEVEL_IDS } from '$lib/levels/registry';
import type { NoteEntry, NotesManifest } from '$lib/notes/types';

/**
 * 学习路径的渲染门禁。
 *
 * 重点不是样式，是三条结构不变量：
 *   1. 模块与章节骨架完整呈现（这是「入门到结束」的路径本身）
 *   2. 关卡出现在它的背景笔记所在模块里
 *   3. **笔记缺失时关卡不能消失** —— 孤儿缺陷的反向形态
 *
 * 数值断言一律走 data-testid：篇数这类数字会同时出现在多处，
 * getByText('4 篇') 在 Playwright 严格模式下会命中多个元素直接报错。
 */

function note(slug: string, title: string): NoteEntry {
	return {
		slug,
		title,
		wordCount: 1000,
		minutes: 3,
		hasCode: false,
		hasMath: false,
		hasMermaid: false,
		hasQuiz: true
	};
}

/** 两个模块三个章节，其中一个章节挂着 kv-cache 关卡的 primary 背景笔记 */
const FIXTURE: NotesManifest = {
	generatedAt: '',
	count: 4,
	modules: [
		{
			id: '00-入门准备',
			label: '入门准备',
			notes: 2,
			sections: [
				{
					section: '',
					notes: [
						note('00-入门准备/01-AI技术全景与概念辨析', 'AI 技术全景'),
						note('00-入门准备/02-学习路线', '学习路线')
					]
				}
			]
		},
		{
			id: '02-llm',
			label: '大语言模型',
			notes: 2,
			sections: [
				{
					section: '推理优化',
					notes: [note('02-llm/05-推理优化/01-KV-Cache与显存分析', 'KV Cache 与显存分析')]
				},
				{
					section: '分词与表示',
					notes: [note('02-llm/02-分词与表示/01-分词算法', '分词算法')]
				}
			]
		}
	]
};

describe('模块与章节骨架', () => {
	it('每个模块渲染一个区块，标题用 manifest 的展示名', async () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		expect(screen.getByTestId('path-module').elements().length).toBe(2);
		await expect.element(screen.getByText('入门准备', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText('大语言模型', { exact: true })).toBeInTheDocument();
	});

	it('模块计数显示篇数，有关卡时附带关卡数', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const metas = screen.getByTestId('module-meta').elements();
		// 入门准备没有关卡；大语言模型挂着 kv-cache 和 tokenizer
		expect(metas[0].textContent).toBe('2 篇');
		expect(metas[1].textContent).toBe('2 篇 · 2 个关卡');
	});

	it('章节名逐个列出，模块根目录下的笔记显示为「概览」', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const chipLists = screen.getByTestId('section-chips').elements();
		const labels = (el: Element) =>
			[...el.querySelectorAll('.chip-label')].map((n) => n.textContent);
		expect(labels(chipLists[0])).toEqual(['概览']);
		expect(labels(chipLists[1])).toEqual(['推理优化', '分词与表示']);
	});

	it('每个模块都有进入笔记库的链接', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const links = screen.container.querySelectorAll('a.module-link');
		expect(links.length).toBe(2);
		for (const a of links) {
			expect(a.getAttribute('href')).toMatch(/notes$/);
		}
	});
});

describe('关卡在路径中的位置', () => {
	it('关卡卡片出现在它背景笔记所在的模块里', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const modules = screen.getByTestId('path-module').elements();
		expect(modules[0].querySelectorAll('a.card').length).toBe(0);
		// kv-cache 与 tokenizer 的 primary 背景笔记都在 02-llm
		expect(modules[1].querySelectorAll('a.card').length).toBe(2);
	});

	it('关卡卡片链接到关卡路由，且保留 a.card 类（冒烟测试依赖它计数）', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const hrefs = [...screen.container.querySelectorAll('a.card')].map((a) =>
			a.getAttribute('href')
		);
		expect(hrefs.some((h) => h?.endsWith('/kv-cache'))).toBe(true);
		expect(hrefs.some((h) => h?.endsWith('/tokenizer'))).toBe(true);
	});

	it('未挂载的关卡进入孤儿区块，不会凭空消失', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const orphan = screen.getByTestId('orphan-levels').element();
		// 5 关里 kv-cache 与 tokenizer 已挂载，其余 3 关落到孤儿区
		expect(orphan.querySelectorAll('a.card').length).toBe(LEVEL_IDS.length - 2);
	});
});

describe('笔记缺失时的降级', () => {
	it('空 manifest 下仍渲染全部关卡（孤儿缺陷的反向形态）', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(EMPTY_MANIFEST) });
		expect(screen.getByTestId('path-module').elements().length).toBe(0);
		expect(screen.container.querySelectorAll('a.card').length).toBe(LEVEL_IDS.length);
	});

	it('全部关卡都是孤儿时不显示「未登记背景笔记」的说明', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(EMPTY_MANIFEST) });
		// 这句只在「有模块但个别关卡没挂上」时才有意义
		expect(screen.container.querySelectorAll('.orphan-note').length).toBe(0);
	});
});

describe('掌握度徽章', () => {
	it('进度未载入时不渲染进度徽章，避免 hydration 前闪烁', () => {
		const screen = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			progressReady: false
		});
		// 代码题数量徽章不依赖进度，仍会显示
		const badges = [...screen.container.querySelectorAll('.badge')].map((b) => b.textContent);
		expect(badges.every((t) => !/^\s*\d+ \/ \d+\s*$/.test(t ?? ''))).toBe(true);
	});
});
