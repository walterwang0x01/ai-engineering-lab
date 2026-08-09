/**
 * 学习进度状态。
 *
 * 用 Svelte 5 runes 管理，组件直接读属性即可获得响应式更新。
 *
 * 一个刻意的设计决定：**连击只在会话内计数，不持久化、不跨天**。
 * 跨天连击（Duolingo 式）靠损失厌恶驱动每日打卡，
 * 但深度技术内容需要的是「一次沉浸两小时」而不是「每天来一下」，
 * 两者的激励方向相反。会话内连击保留即时反馈的爽感，不产生打卡负债。
 */

import type { AttemptRecord } from '$lib/quiz/types';
import { nextSchedule } from '$lib/quiz/schedule';
import { localBackend, type StorageBackend } from './backend';

/** 存储键。带版本号，未来结构变更时可识别旧数据 */
const STORAGE_KEY = 'ael-progress-v1';

interface Persisted {
	version: 1;
	records: Record<string, AttemptRecord>;
}

const EMPTY: Persisted = { version: 1, records: {} };

export class ProgressStore {
	/** 持久化的作答记录 */
	records = $state<Record<string, AttemptRecord>>({});
	/** 会话内连续答对数，刷新页面即归零 */
	streak = $state(0);
	/** 本会话最佳连击 */
	bestStreak = $state(0);

	#backend: StorageBackend;
	#loaded = false;

	constructor(backend: StorageBackend = localBackend) {
		this.#backend = backend;
	}

	/** 从存储载入。幂等，重复调用只生效一次 */
	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;

		const data = this.#backend.read<Persisted>(STORAGE_KEY, EMPTY);
		// 版本不匹配时丢弃旧数据，避免结构不兼容导致运行时错误
		this.records = data?.version === 1 && data.records ? data.records : {};
	}

	#persist(): void {
		this.#backend.write(STORAGE_KEY, { version: 1, records: this.records } satisfies Persisted);
	}

	/**
	 * 记录一次作答，同时更新间隔重复调度和连击。
	 * @returns 更新后的该题记录
	 */
	record(questionId: string, correct: boolean, now = Date.now()): AttemptRecord {
		const prev = this.records[questionId];
		const { box, dueAt } = nextSchedule(prev?.box ?? 0, correct, now);

		const updated: AttemptRecord = {
			questionId,
			attempts: (prev?.attempts ?? 0) + 1,
			correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
			lastAt: now,
			box,
			dueAt
		};

		// 重新赋值整个对象以触发 runes 的深层响应式更新
		this.records = { ...this.records, [questionId]: updated };

		if (correct) {
			this.streak += 1;
			if (this.streak > this.bestStreak) this.bestStreak = this.streak;
		} else {
			this.streak = 0;
		}

		this.#persist();
		return updated;
	}

	/** 读取单题记录 */
	get(questionId: string): AttemptRecord | undefined {
		return this.records[questionId];
	}

	/** 供调度函数使用的精简视图 */
	get scheduleView(): Record<string, { box: number; dueAt: number }> {
		const view: Record<string, { box: number; dueAt: number }> = {};
		for (const [id, rec] of Object.entries(this.records)) {
			view[id] = { box: rec.box, dueAt: rec.dueAt };
		}
		return view;
	}

	/** 清空全部进度 */
	reset(): void {
		this.records = {};
		this.streak = 0;
		this.bestStreak = 0;
		this.#backend.remove(STORAGE_KEY);
	}
}

/** 全站共享的单例 */
export const progress = new ProgressStore();
