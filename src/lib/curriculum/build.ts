/**
 * 把关卡注册表和笔记 manifest join 成学习路径。
 *
 * 纯函数：manifest 由调用方传入（页面从 fetch 拿、测试从磁盘读），
 * 这一层不碰 IO。manifest 是构建期产物、运行时 fetch 的 JSON，
 * 不是 TS 模块，所以无法在这里静态导入。
 */

import { LEVELS } from '$lib/levels/registry';
import type { LevelDefinition } from '$lib/levels/types';
import type { NotesManifest } from '$lib/notes/types';
import { levelForNote, primaryNoteForLevel } from './mapping';
import type { Curriculum, CurriculumModule, CurriculumNote, CurriculumSection } from './types';

/**
 * 构建学习路径。
 *
 * 模块与章节的顺序直接沿用 manifest（由 sync-notes.mjs 按目录名排序），
 * 因为笔记仓库的数字前缀本身就是学习顺序，在这里重排只会引入第二套顺序。
 *
 * @param manifest 笔记 manifest。空 manifest（无笔记源仓库）是合法输入
 * @param levels 关卡列表，默认取全站注册表。参数化只为测试注入
 */
export function buildCurriculum(
	manifest: NotesManifest,
	levels: readonly LevelDefinition[] = LEVELS
): Curriculum {
	/** primary slug → 关卡，用于把关卡挂到章节上 */
	const levelByPrimarySlug = new Map<string, LevelDefinition>();
	for (const level of levels) {
		const primary = primaryNoteForLevel(level.id);
		if (primary) levelByPrimarySlug.set(primary, level);
	}

	/** 已成功挂载的关卡 id，剩下的就是孤儿 */
	const attached = new Set<string>();
	let totalNotes = 0;

	const modules: CurriculumModule[] = (manifest.modules ?? []).map((mod) => {
		let moduleLevelCount = 0;

		const sections: CurriculumSection[] = mod.sections.map((sec) => {
			const sectionLevels: LevelDefinition[] = [];

			const notes: CurriculumNote[] = sec.notes.map((note) => {
				const level = levelByPrimarySlug.get(note.slug);
				if (level && !attached.has(level.id)) {
					sectionLevels.push(level);
					attached.add(level.id);
				}
				// levelId 用反向索引而不是 levelByPrimarySlug：
				// 非 primary 的背景笔记也要能指回关卡
				return { ...note, levelId: levelForNote(note.slug) };
			});

			totalNotes += notes.length;
			moduleLevelCount += sectionLevels.length;

			return { section: sec.section, notes, levels: sectionLevels };
		});

		return {
			id: mod.id,
			label: mod.label,
			sections,
			noteCount: sections.reduce((n, s) => n + s.notes.length, 0),
			levelCount: moduleLevelCount
		};
	});

	// 没挂上的关卡必须单独交出去，否则笔记缺失会让关卡从首页消失
	const orphanLevels = levels.filter((l) => !attached.has(l.id));

	return {
		modules,
		totalNotes,
		orphanLevels: [...orphanLevels],
		totalLevels: levels.length
	};
}

/** 空 manifest，用于笔记未同步时的降级渲染 */
export const EMPTY_MANIFEST: NotesManifest = {
	generatedAt: '',
	count: 0,
	modules: []
};
