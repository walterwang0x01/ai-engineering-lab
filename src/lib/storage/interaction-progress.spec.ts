import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from './backend';
import { InteractionProgressStore } from './interaction-progress.svelte';

describe('InteractionProgressStore', () => {
	it('首次操作只记录必要字段，不保存参数值', () => {
		const store = new InteractionProgressStore(createMemoryBackend());
		store.load();
		store.record('demo', false, 1000);
		expect(store.records.demo).toEqual({ interacted: true, usedPreset: false, lastAt: 1000 });
		expect(Object.keys(store.records.demo)).toEqual(['interacted', 'usedPreset', 'lastAt']);
	});

	it('用过预设后状态只升不降', () => {
		const store = new InteractionProgressStore(createMemoryBackend());
		store.load();
		store.record('demo', true, 1000);
		store.record('demo', false, 2000);
		expect(store.records.demo).toEqual({ interacted: true, usedPreset: true, lastAt: 2000 });
	});

	it('重新创建 store 能从后端恢复记录', () => {
		const backend = createMemoryBackend();
		const first = new InteractionProgressStore(backend);
		first.load();
		first.record('demo', true, 1234);

		const second = new InteractionProgressStore(backend);
		second.load();
		expect(second.hasInteracted('demo')).toBe(true);
		expect(second.records.demo.usedPreset).toBe(true);
	});

	it('reset 只清交互进度，不涉及阅读或题目命名空间', () => {
		const backend = createMemoryBackend();
		const store = new InteractionProgressStore(backend);
		store.load();
		store.record('demo');
		store.reset();
		expect(store.records).toEqual({});
		expect(store.hasInteracted('demo')).toBe(false);
	});
});
