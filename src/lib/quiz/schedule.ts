/**
 * 间隔重复调度（Leitner 盒式，SM-2 的简化变体）。
 *
 * 为什么用间隔重复而不用「每日连击」：
 * 连击奖励的是「每天来一下」，而深度技术内容需要的是「隔几天回来验证还记得」。
 * 检索练习 + 间隔重复的长期留存效果有实证支撑（Karpicke & Blunt, 2011），
 * 而徽章、排行榜这类外部奖励在成人专业学习场景中常见反效果。
 *
 * 全部是纯函数，不碰存储，便于测试。
 */

/** 各熟练度等级对应的复习间隔（天）。下标即 box 等级 */
export const INTERVALS_DAYS = [0, 1, 3, 7, 16, 35] as const;

/** 最高熟练度等级 */
export const MAX_BOX = INTERVALS_DAYS.length - 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleState {
	/** 熟练度等级，0 表示新题或刚答错 */
	box: number;
	/** 下次复习时间戳 */
	dueAt: number;
}

/**
 * 根据本次作答结果计算下次复习时间。
 *
 * 答对：升一级，间隔按 INTERVALS_DAYS 拉长
 * 答错：直接归零（不是减一级）——答错说明检索失败，需要从头巩固
 *
 * @param box 当前等级
 * @param correct 本次是否答对
 * @param now 当前时间戳，显式传入便于测试
 */
export function nextSchedule(box: number, correct: boolean, now: number): ScheduleState {
	const current = Number.isFinite(box) ? Math.max(0, Math.min(MAX_BOX, Math.trunc(box))) : 0;

	if (!correct) {
		// 答错归零，且立即可再练（间隔 0 天）
		return { box: 0, dueAt: now };
	}

	const next = Math.min(current + 1, MAX_BOX);
	return { box: next, dueAt: now + INTERVALS_DAYS[next] * DAY_MS };
}

/** 判断一道题此刻是否到期需要复习 */
export function isDue(dueAt: number, now: number): boolean {
	return dueAt <= now;
}

/**
 * 从题目集合中挑出今天该练的。
 *
 * 优先级：从未做过的新题 → 已到期的旧题（越早到期越优先）。
 * 新题优先是因为「学新的」比「复习旧的」动机更强，先给正反馈。
 *
 * @param allIds 全部题目 id
 * @param records 已有作答记录，键为题目 id
 * @param now 当前时间戳
 * @param limit 最多返回多少道，避免一次给太多产生压迫感
 */
export function buildDueDeck(
	allIds: string[],
	records: Record<string, { box: number; dueAt: number }>,
	now: number,
	limit = 12
): string[] {
	const fresh: string[] = [];
	const due: Array<{ id: string; dueAt: number }> = [];

	for (const id of allIds) {
		const rec = records[id];
		if (!rec) {
			fresh.push(id);
		} else if (isDue(rec.dueAt, now)) {
			due.push({ id, dueAt: rec.dueAt });
		}
	}

	due.sort((a, b) => a.dueAt - b.dueAt);
	return [...fresh, ...due.map((d) => d.id)].slice(0, limit);
}

/** 掌握度统计，用于能力可视化 */
export interface MasteryStats {
	total: number;
	/** 从未作答 */
	untouched: number;
	/** 正在学（box 1..MAX_BOX-1） */
	learning: number;
	/** 已掌握（box 达到上限） */
	mastered: number;
	/** 需要重练（有记录但 box 为 0） */
	struggling: number;
}

export function summarizeMastery(
	allIds: string[],
	records: Record<string, { box: number; dueAt: number }>
): MasteryStats {
	const stats: MasteryStats = {
		total: allIds.length,
		untouched: 0,
		learning: 0,
		mastered: 0,
		struggling: 0
	};

	for (const id of allIds) {
		const rec = records[id];
		if (!rec) stats.untouched++;
		else if (rec.box >= MAX_BOX) stats.mastered++;
		else if (rec.box === 0) stats.struggling++;
		else stats.learning++;
	}

	return stats;
}
