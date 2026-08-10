import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { LEVEL_IDS, LEVELS } from '$lib/levels/registry';
import type { NotesManifest } from '$lib/notes/types';
import {
	LEVEL_BACKGROUND_NOTES,
	MAPPED_LEVEL_IDS,
	MAPPED_NOTE_SLUGS,
	levelForNote,
	notesForLevel,
	primaryNoteForLevel
} from './mapping';
import { EMPTY_MANIFEST, buildCurriculum } from './build';

/**
 * curriculum 层的门禁。
 *
 * 分成两类，分界线是「需不需要真实的笔记 manifest」：
 *
 *   - **结构门禁**：只看映射表和 registry，任何环境都跑。
 *   - **一致性门禁**：要校验 slug 在 manifest 里真实存在，需要先跑
 *     `pnpm run notes:sync`（它需要笔记源仓库）。
 *
 * 一致性门禁在 manifest 缺失时用 `it.skipIf` 跳过，让 vitest 把它报成
 * skipped 而不是 passed——AGENTS.md 第 6 条记的就是这个坑：
 * 静默不跑而 CI 显示绿色，是最难发现的失败模式。
 * CI 里则通过 `REQUIRE_NOTES=1` 把「manifest 缺失」本身变成硬失败。
 */

const MANIFEST_PATH = 'static/notes/manifest.json';

function loadManifest(): NotesManifest | null {
	if (!existsSync(MANIFEST_PATH)) return null;
	try {
		return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as NotesManifest;
	} catch {
		return null;
	}
}

const manifest = loadManifest();
/** manifest 存在且真的有笔记。空 manifest 是 sync-notes.mjs 无源时的兜底产物 */
const notesReady = manifest !== null && manifest.count > 0;
const notesRequired = process.env.REQUIRE_NOTES === '1';

describe('笔记 manifest 的可用性', () => {
	it('必须已同步，除非显式允许缺失（REQUIRE_NOTES 未置位）', () => {
		expect(
			notesReady || !notesRequired,
			`REQUIRE_NOTES=1 但 ${MANIFEST_PATH} 缺失或为空。` +
				'映射一致性门禁会被跳过，等于 CI 绿了却没校验。' +
				'先跑 pnpm run notes:sync（需要 NOTES_SRC 指向笔记源仓库）。'
		).toBe(true);
	});
});

describe('映射表结构', () => {
	it('registry 里的每个关卡都登记了背景笔记', () => {
		const missing = LEVEL_IDS.filter((id) => notesForLevel(id).length === 0);
		expect(missing, `这些关卡没有背景笔记，会落进 orphanLevels：${missing.join(', ')}`).toEqual([]);
	});

	it('映射表不引用未知的关卡 id', () => {
		const unknown = MAPPED_LEVEL_IDS.filter((id) => !LEVEL_IDS.includes(id));
		expect(unknown, `映射表引用了 registry 里不存在的关卡：${unknown.join(', ')}`).toEqual([]);
	});

	it('一篇笔记只属于一个关卡', () => {
		const dupes = MAPPED_NOTE_SLUGS.filter((s, i) => MAPPED_NOTE_SLUGS.indexOf(s) !== i);
		expect(dupes, `同一篇被多个关卡引用，笔记页指回关卡时有歧义：${dupes.join(', ')}`).toEqual([]);
	});

	it('slug 格式合法：至少两段路径、不带 .md、不带前后斜杠', () => {
		for (const slug of MAPPED_NOTE_SLUGS) {
			expect(slug.endsWith('.md'), `${slug} 不应带 .md 后缀`).toBe(false);
			expect(slug.startsWith('/') || slug.endsWith('/'), `${slug} 不应有前后斜杠`).toBe(false);
			expect(slug.split('/').length, `${slug} 至少要有「模块/篇目」两段`).toBeGreaterThanOrEqual(2);
		}
	});

	it('primary 是数组第一条，反向查询与正向一致', () => {
		for (const [levelId, slugs] of Object.entries(LEVEL_BACKGROUND_NOTES)) {
			expect(primaryNoteForLevel(levelId)).toBe(slugs[0]);
			for (const slug of slugs) {
				expect(levelForNote(slug), `${slug} 应反查到 ${levelId}`).toBe(levelId);
			}
		}
	});

	it('未登记的关卡与未知 slug 返回空值而不是抛错', () => {
		expect(notesForLevel('no-such-level')).toEqual([]);
		expect(primaryNoteForLevel('no-such-level')).toBeUndefined();
		expect(levelForNote('no/such/note')).toBeUndefined();
	});
});

describe('学习路径构建', () => {
	it('空 manifest 下全部关卡进 orphanLevels，一个都不丢', () => {
		const c = buildCurriculum(EMPTY_MANIFEST);
		expect(c.modules).toEqual([]);
		expect(c.totalNotes).toBe(0);
		expect(c.orphanLevels.map((l) => l.id).sort()).toEqual([...LEVEL_IDS].sort());
		expect(c.totalLevels).toBe(LEVELS.length);
	});

	it('关卡挂在 primary 背景笔记所在的章节', () => {
		const fake: NotesManifest = {
			generatedAt: '',
			count: 2,
			modules: [
				{
					id: '02-llm',
					label: '大语言模型',
					notes: 2,
					sections: [
						{
							dir: '05-推理优化',
							section: '推理优化',
							notes: [
								{
									slug: '02-llm/05-推理优化/01-KV-Cache与显存分析',
									title: 'KV Cache 与显存分析',
									wordCount: 100,
									minutes: 1,
									hasCode: false,
									hasMath: true,
									hasMermaid: false,
									hasQuiz: true
								}
							]
						},
						{
							dir: '99-无关章节',
							section: '无关章节',
							notes: [
								{
									slug: '02-llm/99-其他/01-无关篇目',
									title: '无关篇目',
									wordCount: 100,
									minutes: 1,
									hasCode: false,
									hasMath: false,
									hasMermaid: false,
									hasQuiz: false
								}
							]
						}
					]
				}
			]
		};

		const c = buildCurriculum(fake);
		const [withLevel, without] = c.modules[0].sections;

		expect(withLevel.levels.map((l) => l.id)).toEqual(['kv-cache']);
		expect(withLevel.notes[0].levelId).toBe('kv-cache');
		expect(without.levels).toEqual([]);
		expect(without.notes[0].levelId).toBeUndefined();
		expect(c.modules[0].levelCount).toBe(1);
		expect(c.totalNotes).toBe(2);
		// 其余 4 关的 primary 不在这份 manifest 里，必须仍然可达
		expect(c.orphanLevels.map((l) => l.id).sort()).toEqual(
			LEVEL_IDS.filter((id) => id !== 'kv-cache').sort()
		);
	});
});

describe.skipIf(!notesReady)('与真实 manifest 的一致性', () => {
	const real = manifest as NotesManifest;

	it('每个模块的章节按目录数字前缀升序 —— 学习顺序不能退化成字母序', () => {
		for (const mod of real.modules) {
			const dirs = mod.sections.map((s) => s.dir);
			const sorted = [...dirs].sort((a, b) => a.localeCompare(b, 'zh-CN'));
			expect(
				dirs,
				`模块 ${mod.id} 的章节顺序不是目录顺序。` +
					'目录的数字前缀就是作者定的学习顺序，按剥掉前缀的展示名排序会把它打乱' +
					'（曾把「数学基础」排到第 5 位、「Transformer 原理」排到大模型模块最后）。'
			).toEqual(sorted);
		}
	});

	it('章节同时给出排序键与展示名，展示名不含数字前缀', () => {
		for (const mod of real.modules) {
			for (const sec of mod.sections) {
				if (sec.dir === '') {
					expect(sec.section).toBe('');
					continue;
				}
				expect(sec.dir, `${mod.id}/${sec.dir} 缺数字前缀`).toMatch(/^\d+-/);
				expect(sec.section, `${sec.dir} 的展示名不该带数字前缀`).not.toMatch(/^\d+-/);
			}
		}
	});

	it('模块自身也按数字前缀升序', () => {
		const ids = real.modules.map((m) => m.id);
		expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b, 'zh-CN')));
	});

	it('映射表引用的每篇笔记都在 manifest 里存在', () => {
		const known = new Set(
			real.modules.flatMap((m) => m.sections.flatMap((s) => s.notes.map((n) => n.slug)))
		);
		const missing = MAPPED_NOTE_SLUGS.filter((s) => !known.has(s));
		expect(
			missing,
			`这些 slug 在 manifest 里找不到，笔记可能被改名或移动：\n  ${missing.join('\n  ')}`
		).toEqual([]);
	});

	it('join 之后不丢篇目，总数与 manifest.count 相等', () => {
		expect(buildCurriculum(real).totalNotes).toBe(real.count);
	});

	it('真实 manifest 下没有孤儿关卡', () => {
		expect(
			buildCurriculum(real).orphanLevels.map((l) => l.id),
			'关卡没挂进学习路径，首页只能靠 orphanLevels 兜底渲染'
		).toEqual([]);
	});

	it('每个关卡都能从它的背景笔记反向找到', () => {
		const c = buildCurriculum(real);
		const flagged = new Map<string, string[]>();
		for (const mod of c.modules) {
			for (const sec of mod.sections) {
				for (const note of sec.notes) {
					if (!note.levelId) continue;
					flagged.set(note.levelId, [...(flagged.get(note.levelId) ?? []), note.slug]);
				}
			}
		}
		for (const id of LEVEL_IDS) {
			expect(flagged.get(id)?.sort(), `${id} 的背景笔记没有被标注 levelId`).toEqual(
				[...notesForLevel(id)].sort()
			);
		}
	});
});
