import { localBackend, type StorageBackend } from './backend';

const STORAGE_KEY = 'ael-interaction-progress-v1';

export interface InteractionProgressRecord {
	interacted: boolean;
	usedPreset: boolean;
	lastAt: number;
}

interface Persisted {
	version: 1;
	records: Record<string, InteractionProgressRecord>;
}

const EMPTY: Persisted = { version: 1, records: {} };

/**
 * 可调实验进度。
 *
 * 与「已读」和「题目掌握度」严格分离：拖过滑块不等于读完，更不等于掌握。
 * 只记录是否体验过、是否用过预设和最后时间；不记录每次参数值，避免把本地存储
 * 变成行为日志，也避免用户刷新后进入一个自己忘记来源的奇怪状态。
 */
export class InteractionProgressStore {
	records = $state<Record<string, InteractionProgressRecord>>({});
	#backend: StorageBackend;
	#loaded = false;

	constructor(backend: StorageBackend = localBackend) {
		this.#backend = backend;
	}

	load(): void {
		if (this.#loaded) return;
		this.#loaded = true;
		const data = this.#backend.read<Persisted>(STORAGE_KEY, EMPTY);
		this.records = data?.version === 1 && data.records ? data.records : {};
	}

	record(id: string, usedPreset = false, now = Date.now()): void {
		const previous = this.records[id];
		this.records = {
			...this.records,
			[id]: {
				interacted: true,
				usedPreset: previous?.usedPreset === true || usedPreset,
				lastAt: now
			}
		};
		this.#backend.write(STORAGE_KEY, { version: 1, records: this.records } satisfies Persisted);
	}

	hasInteracted(id: string): boolean {
		return this.records[id]?.interacted === true;
	}

	reset(): void {
		this.records = {};
		this.#backend.remove(STORAGE_KEY);
	}
}

export const interactionProgress = new InteractionProgressStore();
