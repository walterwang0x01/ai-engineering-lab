/**
 * 统一学习进度视图。
 *
 * 站里有两套互不相干的进度存储，各自都有正当理由：
 *
 *   - `progress.svelte.ts`（`ael-progress-v1`）—— 题目的 Leitner 间隔重复调度
 *   - `notes-progress.svelte.ts`（`ael-notes-progress-v1`）—— 笔记的已读集合
 *
 * 它们**继续保持独立**，不合并存储：把阅读行为混进掌握度统计会污染调度，
 * 而合并 key 还要写数据迁移，得不偿失。
 *
 * 这一层只做**读时合并**，解决的是展示层的矛盾：
 * 同一篇笔记既可能「已读」又可能「配套关卡已掌握」，
 * 两个数字各说各话时用户不知道该信哪个。
 *
 * 唯一的裁决规则：**可判定信号优先于自评信号。**
 * 有配套关卡时以掌握度为准；点没点过「标记为读完」不改变结论——
 * 题都做对了却因为没点按钮显示「未开始」，是最没道理的一种状态。
 * 这条规则与 README 的立论一致：判定由程序说了算，不是自评。
 */

import { summarizeMastery, type MasteryStats } from '$lib/quiz/schedule';
import { getLevel } from '$lib/levels/registry';
import { levelForNote } from './mapping';
import type { Curriculum, CurriculumNote } from './types';

/** 调度视图，与 summarizeMastery / buildDueDeck 的入参一致 */
export type ScheduleView = Record<string, { box: number; dueAt: number }>;

export interface ProgressInputs {
	/** 已读笔记的 slug 集合 */
	read: ReadonlySet<string>;
	/** 题目的间隔重复记录 */
	schedule: ScheduleView;
	/**
	 * slug → 该篇自带的 Tier A 题目 id（来自 static/notes/gradable.json）。
	 *
	 * 必须传：没有配套关卡但有 Tier A 题的笔记（目前的入门准备 4 篇就是这样），
	 * 只看关卡会把它判成「未开始」——题都答对了却显示没开始，是线上实测抓到的缺陷。
	 */
	noteQuestionIds?: Readonly<Record<string, readonly string[]>>;
}

/**
 * 一篇笔记的学习状态。
 *
 * `gradable` 为 null 表示这篇还没有可判定内容（Tier A 尚未覆盖到），
 * 此时只能退回「读过 / 没读过」这个自评信号。
 */
export interface NoteProgress {
	slug: string;
	/** 是否点过「标记为读完」。保留原始信号，界面仍可展示 */
	read: boolean;
	/** 有配套关卡时的掌握度，否则 null */
	gradable: MasteryStats | null;
	/**
	 * 汇总结论，界面直接用这个：
	 *   - `mastered`    可判定内容已全部掌握
	 *   - `in-progress` 有作答记录但没掌握完
	 *   - `read`        只读过，没有可判定信号
	 *   - `untouched`   既没读也没做
	 */
	state: 'mastered' | 'in-progress' | 'read' | 'untouched';
}

/**
 * 判定单篇笔记的状态。可判定信号优先，`read` 只在没有可判定信号时决定结论。
 *
 * 「可判定内容」有两个来源，合起来算：
 *   - 这篇自带的 Tier A 题（笔记里的选择题）
 *   - 配套关卡的题库
 * 两者都没有时才退回「读过 / 没读过」。
 */
export function noteProgress(
	note: Pick<CurriculumNote, 'slug'>,
	inputs: ProgressInputs
): NoteProgress {
	const read = inputs.read.has(note.slug);
	const levelId = levelForNote(note.slug);
	const level = levelId ? getLevel(levelId) : undefined;

	const ids = [
		...(inputs.noteQuestionIds?.[note.slug] ?? []),
		...(level?.questions.map((q) => q.id) ?? [])
	];

	if (ids.length === 0) {
		return { slug: note.slug, read, gradable: null, state: read ? 'read' : 'untouched' };
	}

	const gradable = summarizeMastery(ids, inputs.schedule);

	// 掌握度优先：做完题就是 mastered，与有没有点「已读」无关
	if (gradable.mastered === gradable.total) {
		return { slug: note.slug, read, gradable, state: 'mastered' };
	}
	if (gradable.untouched < gradable.total) {
		return { slug: note.slug, read, gradable, state: 'in-progress' };
	}
	return { slug: note.slug, read, gradable, state: read ? 'read' : 'untouched' };
}

export interface ModuleProgress {
	moduleId: string;
	noteCount: number;
	/** 点过「标记为读完」的篇数 */
	readCount: number;
	/** 有可判定内容的篇数 */
	gradableNotes: number;
	/** 可判定内容已全部掌握的篇数 */
	masteredNotes: number;
	/** 题目层面的合计，用于「12 / 52 题已掌握」这类展示 */
	questions: { total: number; mastered: number };
}

/** 汇总一个模块的进度 */
export function moduleProgress(
	module: Curriculum['modules'][number],
	inputs: ProgressInputs
): ModuleProgress {
	const summary: ModuleProgress = {
		moduleId: module.id,
		noteCount: 0,
		readCount: 0,
		gradableNotes: 0,
		masteredNotes: 0,
		questions: { total: 0, mastered: 0 }
	};

	/** 同一关卡可能是多篇笔记的配套，关卡题只能计一次 */
	const countedLevels = new Set<string>();

	for (const section of module.sections) {
		for (const note of section.notes) {
			summary.noteCount += 1;
			const p = noteProgress(note, inputs);
			if (p.read) summary.readCount += 1;
			if (!p.gradable) continue;

			summary.gradableNotes += 1;
			if (p.state === 'mastered') summary.masteredNotes += 1;

			// 笔记自带的 Tier A 题是这一篇独有的，直接计入
			const own = inputs.noteQuestionIds?.[note.slug] ?? [];
			if (own.length > 0) {
				const ownStats = summarizeMastery([...own], inputs.schedule);
				summary.questions.total += ownStats.total;
				summary.questions.mastered += ownStats.mastered;
			}

			// 关卡题按关卡去重，否则一关配两篇笔记会把题数放大一倍
			const levelId = levelForNote(note.slug);
			const level = levelId ? getLevel(levelId) : undefined;
			if (level && levelId && !countedLevels.has(levelId)) {
				countedLevels.add(levelId);
				const levelStats = summarizeMastery(
					level.questions.map((q) => q.id),
					inputs.schedule
				);
				summary.questions.total += levelStats.total;
				summary.questions.mastered += levelStats.mastered;
			}
		}
	}

	return summary;
}

/** 全站汇总 */
export function curriculumProgress(
	curriculum: Curriculum,
	inputs: ProgressInputs
): ModuleProgress[] {
	return curriculum.modules.map((mod) => moduleProgress(mod, inputs));
}
