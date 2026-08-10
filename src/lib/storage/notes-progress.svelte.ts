/**
 * 笔记阅读进度状态。
 *
 * 与 quiz 的 progress.svelte.ts 完全独立：不同的 localStorage key、
 * 不同的数据结构（已读集合，不涉及间隔重复调度）。
 * 两者不共享存储，避免笔记阅读行为污染题目掌握度统计。
 */

import { SvelteSet } from 'svelte/reactivity';
import { localBackend, type StorageBackend } from './backend';

const STORAGE_KEY = 'ael-notes-progress-v1';

interface Persisted {
	version: 1;
	/** 已读笔记的 slug 集合 */
	read: string[];
}

const EMPTY: Persisted = { version: 1, read: [] };

export class NotesProgressStore {
	/**
	 * 已读笔记 slug 集合。
	 *
	 * 用 SvelteSet 而不是原生 Set + 每次重建：
	 * 原生 Set 的 add/delete 不会触发 runes 更新，只能靠重新赋值，
	 * 而那是 O(n) 拷贝 —— 168 篇笔记下每次标记已读都拷一遍没有必要。
	 * SvelteSet 的变更本身就是响应式的。
	 */
	read = new SvelteSet<string>();

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
		const slugs = data?.version === 1 && Array.isArray(data.read) ? data.read : [];
		this.read.clear();
		for (const slug of slugs) this.read.add(slug);
	}

	#persist(): void {
		this.#backend.write(STORAGE_KEY, { version: 1, read: [...this.read] } satisfies Persisted);
	}

	/** 标记一篇笔记为已读 */
	markRead(slug: string): void {
		if (this.read.has(slug)) return;
		this.read.add(slug);
		this.#persist();
	}

	isRead(slug: string): boolean {
		return this.read.has(slug);
	}

	/** 清空全部阅读进度 */
	reset(): void {
		this.read.clear();
		this.#backend.remove(STORAGE_KEY);
	}
}

/** 全站共享的单例 */
export const notesProgress = new NotesProgressStore();
