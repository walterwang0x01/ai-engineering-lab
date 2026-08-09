/**
 * 持久化后端。
 *
 * 目前用 localStorage：按每条记录约 100 字节估算，
 * 上千道题的作答记录约 100 KB，远低于 localStorage 的 5 MB 上限。
 * 上 IndexedDB 在当前数据量下属于过度设计。
 *
 * 所有读写都经过这个模块，未来数据量涨了只需替换这里的实现。
 *
 * 两个必须处理的现实：
 * 1. 预渲染时运行在 Node 里，没有 window
 * 2. 隐私模式 / 存储配额满时 localStorage 会抛异常
 */

export interface StorageBackend {
	read<T>(key: string, fallback: T): T;
	write(key: string, value: unknown): boolean;
	remove(key: string): void;
}

/** 判断当前环境是否可用 localStorage */
function isAvailable(): boolean {
	try {
		return typeof globalThis.localStorage !== 'undefined';
	} catch {
		// 某些环境下访问 localStorage 本身就会抛（如禁用 cookie 的 iframe）
		return false;
	}
}

export const localBackend: StorageBackend = {
	read<T>(key: string, fallback: T): T {
		if (!isAvailable()) return fallback;
		try {
			const raw = globalThis.localStorage.getItem(key);
			if (raw === null) return fallback;
			return JSON.parse(raw) as T;
		} catch {
			// 数据损坏或 JSON 非法时退回默认值，不让坏数据阻断整个应用
			return fallback;
		}
	},

	write(key: string, value: unknown): boolean {
		if (!isAvailable()) return false;
		try {
			globalThis.localStorage.setItem(key, JSON.stringify(value));
			return true;
		} catch {
			// 配额满或隐私模式：静默失败，学习流程继续，只是不留痕
			return false;
		}
	},

	remove(key: string): void {
		if (!isAvailable()) return;
		try {
			globalThis.localStorage.removeItem(key);
		} catch {
			/* 忽略 */
		}
	}
};

/** 内存后端，用于测试和不支持存储的环境 */
export function createMemoryBackend(): StorageBackend {
	const store = new Map<string, string>();
	return {
		read<T>(key: string, fallback: T): T {
			const raw = store.get(key);
			if (raw === undefined) return fallback;
			try {
				return JSON.parse(raw) as T;
			} catch {
				return fallback;
			}
		},
		write(key: string, value: unknown): boolean {
			try {
				store.set(key, JSON.stringify(value));
				return true;
			} catch {
				return false;
			}
		},
		remove(key: string): void {
			store.delete(key);
		}
	};
}
