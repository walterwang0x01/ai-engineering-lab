import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LearningPath from './LearningPath.svelte';
import { EMPTY_MANIFEST, buildCurriculum } from '$lib/curriculum/build';
import { LEVEL_IDS, getLevel } from '$lib/levels/registry';
import { MAX_BOX } from '$lib/quiz/schedule';
import { progress } from '$lib/storage/progress.svelte';
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
		hasQuiz: true,
		gradable: 0,
		thinking: 0
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
					dir: '',
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
					dir: '05-推理优化',
					section: '推理优化',
					notes: [note('02-llm/05-推理优化/01-KV-Cache与显存分析', 'KV Cache 与显存分析')]
				},
				{
					dir: '02-分词与表示',
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

	it('模块计数依次给出篇数、题数、关卡数', () => {
		const kv = getLevel('kv-cache');
		const tok = getLevel('tokenizer');
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const metas = screen.getByTestId('module-meta').elements();
		// 入门准备没有关卡也没有 Tier A 题
		expect(metas[0].textContent).toBe('2 篇');
		// 大语言模型挂着 kv-cache 与 tokenizer，题数是两关之和
		const qs = (kv?.questions.length ?? 0) + (tok?.questions.length ?? 0);
		expect(metas[1].textContent).toBe(`2 篇 · ${qs} 道题 · 2 个关卡`);
	});

	it('有真实章节的模块逐个列出章节名，只有根目录的模块不列', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const chipLists = screen.getByTestId('section-chips').elements();
		// 入门准备只有根目录一个章节 → 不渲染 chips，所以只剩大语言模型这一组
		expect(chipLists.length).toBe(1);
		expect([...chipLists[0].querySelectorAll('.chip-label')].map((n) => n.textContent)).toEqual([
			'推理优化',
			'分词与表示'
		]);
	});

	it('只有「模块根目录」一个章节时不渲染 chips（避免把同一个数字说两遍）', () => {
		const single: NotesManifest = {
			generatedAt: '',
			count: 1,
			modules: [
				{
					id: '00-入门准备',
					label: '入门准备',
					notes: 1,
					sections: [{ dir: '', section: '', notes: [note('00-入门准备/01-x', 'X')] }]
				}
			]
		};
		const screen = render(LearningPath, { curriculum: buildCurriculum(single) });
		expect(screen.getByTestId('path-module').elements().length).toBe(1);
		expect(screen.container.querySelectorAll('[data-testid="section-chips"]').length).toBe(0);
	});

	it('Tier A 题计入模块题数，让首页能看见可判定内容', () => {
		const screen = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			noteQuestionIds: {
				'00-入门准备/01-AI技术全景与概念辨析': ['note:a-1', 'note:a-2', 'note:a-3'],
				'00-入门准备/02-学习路线': ['note:b-1', 'note:b-2']
			}
		});
		expect(screen.getByTestId('module-meta').elements()[0].textContent).toBe('2 篇 · 5 道题');
	});

	it('模块名链到笔记库里该模块的锚点，而不是笔记库首页', () => {
		// 5 个模块标题原来全指向同一个 /notes：点「AI Agent 工程」（105 篇）
		// 落到大而全的列表页还得再找一遍，这是复查里的严重度 3
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const links = [...screen.container.querySelectorAll('a.mod-link')];
		expect(links.length).toBe(2);
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			expect.stringContaining('/notes#m-00-入门准备'),
			expect.stringContaining('/notes#m-02-llm')
		]);
	});

	it('章节 chip 是真链接，通向对应章节的锚点', () => {
		// chip 原来是 <li><span>、cursor:auto、无 href —— 但长得就是胶囊按钮。
		// 复查者进站第一个动作就是去点它，毫无反应，「以为站崩了」
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const chips = [...screen.container.querySelectorAll('a.chip-link')];
		expect(chips.length).toBeGreaterThan(0);
		for (const a of chips) {
			expect(a.getAttribute('href')).toMatch(/\/notes#[ms]-/);
		}
		expect(chips.some((a) => a.getAttribute('href')?.includes('#s-02-llm-05-推理优化'))).toBe(true);
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

describe('进度可视化（方案 A 的核心）', () => {
	it('进度未载入时不渲染进度条，避免 hydration 前闪烁', () => {
		const screen = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			progressReady: false
		});
		expect(screen.container.querySelectorAll('[data-testid="module-bar"]').length).toBe(0);
	});

	it('进度条按已掌握 / 在学 / 需重练分段，宽度按题数占比', () => {
		const ids = ['note:a-1', 'note:a-2', 'note:a-3', 'note:a-4'];
		progress.records = {};
		for (const [id, box] of [
			[ids[0], MAX_BOX],
			[ids[1], MAX_BOX],
			[ids[2], 1]
		] as const) {
			progress.records[id] = { questionId: id, attempts: 1, correct: 1, lastAt: 0, box, dueAt: 0 };
		}

		const screen = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			noteQuestionIds: { '00-入门准备/01-AI技术全景与概念辨析': ids },
			progressReady: true
		});

		const bar = screen.getByTestId('module-bar').elements()[0];
		const [done, learning] = bar.querySelectorAll('i');
		// 4 道题：2 已掌握 = 50%，1 在学 = 25%
		expect(done.getAttribute('style')).toContain('50%');
		expect(learning.getAttribute('style')).toContain('25%');
		expect(screen.getByTestId('module-legend').elements()[0].textContent).toBe(
			'2 道已掌握 · 1 道在学 · 1 道未做'
		);
		progress.records = {};
	});

	it('图例只列非零的档，不显示「0 道需重练」这类噪声', () => {
		progress.records = {};
		const screen = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			noteQuestionIds: { '00-入门准备/01-AI技术全景与概念辨析': ['note:z-1'] },
			progressReady: true
		});
		expect(screen.getByTestId('module-legend').elements()[0].textContent).toBe('1 道未做');
	});
});

describe('章节 chip 折叠', () => {
	/** 造一个有 9 个章节的模块，超过 6 个的展示上限 */
	const many: NotesManifest = {
		generatedAt: '',
		count: 9,
		modules: [
			{
				id: '01-m',
				label: '多章节模块',
				notes: 9,
				sections: Array.from({ length: 9 }, (_, i) => ({
					dir: `0${i}-s${i}`,
					section: `章节${i}`,
					notes: [note(`01-m/0${i}-s${i}/01-x`, `X${i}`)]
				}))
			}
		]
	};

	it('超过 6 个章节时折叠，按钮说明还有几个', async () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(many) });
		expect(screen.container.querySelectorAll('.chip-label').length).toBe(6);
		await expect
			.element(screen.getByRole('button', { name: '还有 3 个章节 ▾' }))
			.toBeInTheDocument();
	});

	it('点开之后全部章节可见，按钮变成收起', async () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(many) });
		await screen.getByRole('button', { name: '还有 3 个章节 ▾' }).click();
		expect(screen.container.querySelectorAll('.chip-label').length).toBe(9);
		await expect.element(screen.getByRole('button', { name: '收起章节 ▴' })).toBeInTheDocument();
	});

	it('不超过 6 个章节时没有折叠按钮', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		expect(screen.container.querySelectorAll('.chip-more').length).toBe(0);
	});
});

describe('关卡行', () => {
	it('进度未载入时显示题数，载入后换成进度环', () => {
		const before = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			progressReady: false
		});
		expect(before.container.querySelectorAll('.ring').length).toBe(0);
		expect(before.container.querySelectorAll('.lv-q').length).toBeGreaterThan(0);

		const after = render(LearningPath, {
			curriculum: buildCurriculum(FIXTURE),
			progressReady: true
		});
		expect(after.container.querySelectorAll('.ring').length).toBeGreaterThan(0);
	});

	it('副标题由数据拼出：指明读完哪一章之后用它验证', () => {
		const screen = render(LearningPath, { curriculum: buildCurriculum(FIXTURE) });
		const subs = [...screen.container.querySelectorAll('.lv-sub')].map((n) => n.textContent);
		expect(subs.some((t) => t?.includes('读完「推理优化」之后用它验证'))).toBe(true);
		expect(subs.some((t) => t?.includes('浏览器内 Python 题'))).toBe(true);
	});
});
