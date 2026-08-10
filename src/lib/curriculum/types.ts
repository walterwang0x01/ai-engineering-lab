/**
 * 学习路径（curriculum）的类型契约。
 *
 * 这一层解决的是一个真实缺陷：`levels/registry.ts` 的 5 个关卡和
 * `static/notes/manifest.json` 的 168 篇笔记是两个互不知晓的数据源，
 * 首页只渲染前者，于是 168 篇笔记在线上是孤儿页面——
 * 部署好了、能返回 200、但站内没有任何链接指向它。
 *
 * curriculum 把两者 join 成单一的学习路径视图：
 * 模块 → 章节 → 篇目，关卡挂在它的背景笔记所在章节上。
 * 首页和导航都从这里派生，不再各自手写。
 */

import type { LevelDefinition } from '$lib/levels/types';
import type { NoteEntry } from '$lib/notes/types';

/** 学习路径里的一篇笔记。比 NoteEntry 多一个「有没有对应关卡」 */
export interface CurriculumNote extends NoteEntry {
	/** 该篇是某个关卡的背景笔记时，关卡 id。用于笔记页反向指回关卡 */
	levelId?: string;
}

export interface CurriculumSection {
	/** 章节名。模块根目录下的笔记此字段为空字符串，与 NoteSection 一致 */
	section: string;
	notes: CurriculumNote[];
	/**
	 * 挂在本章节的关卡。
	 *
	 * 归属规则：关卡的 primary 背景笔记（映射表里的第一条）落在哪个章节，
	 * 关卡就挂在那个章节。一个章节可以有多个关卡，也可以没有。
	 */
	levels: LevelDefinition[];
}

export interface CurriculumModule {
	id: string;
	label: string;
	sections: CurriculumSection[];
	/** 本模块笔记总数，供首页显示「4 篇」这类计数 */
	noteCount: number;
	/** 本模块挂载的关卡数 */
	levelCount: number;
}

export interface Curriculum {
	modules: CurriculumModule[];
	totalNotes: number;
	/**
	 * 没能挂进任何模块的关卡。
	 *
	 * 存在两种触发情形，都必须让关卡仍然可达：
	 *   1. 本地开发没有笔记源仓库，manifest 是空的（sync-notes.mjs 的兜底）
	 *   2. 新增关卡还没在映射表里登记背景笔记
	 *
	 * 首页必须单独渲染这一段。否则「笔记缺失 → 关卡也从首页消失」，
	 * 等于把原来的孤儿缺陷反向复制一遍。
	 */
	orphanLevels: LevelDefinition[];
	/** 挂进模块的关卡数 + orphanLevels 长度，恒等于 registry 的关卡总数 */
	totalLevels: number;
}
