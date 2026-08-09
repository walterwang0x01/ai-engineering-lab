import { beforeEach, describe, expect, it } from 'vitest';
import { ProgressStore } from './progress.svelte';
import { createMemoryBackend, type StorageBackend } from './backend';
import { MAX_BOX } from '$lib/quiz/schedule';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('ProgressStore', () => {
	let backend: StorageBackend;
	let store: ProgressStore;

	beforeEach(() => {
		backend = createMemoryBackend();
		store = new ProgressStore(backend);
		store.load();
	});

	it('初始状态为空', () => {
		expect(store.records).toEqual({});
		expect(store.streak).toBe(0);
	});

	it('记录一次答对，生成完整记录', () => {
		const rec = store.record('q1', true, NOW);
		expect(rec).toMatchObject({
			questionId: 'q1',
			attempts: 1,
			correct: 1,
			lastAt: NOW,
			box: 1
		});
		expect(rec.dueAt).toBe(NOW + DAY);
	});

	it('答对累加连击', () => {
		store.record('q1', true, NOW);
		store.record('q2', true, NOW);
		store.record('q3', true, NOW);
		expect(store.streak).toBe(3);
		expect(store.bestStreak).toBe(3);
	});

	it('答错清零连击但保留最佳记录', () => {
		store.record('q1', true, NOW);
		store.record('q2', true, NOW);
		store.record('q3', false, NOW);
		expect(store.streak).toBe(0);
		expect(store.bestStreak).toBe(2);
	});

	it('同一题多次作答累加计数', () => {
		store.record('q1', false, NOW);
		store.record('q1', true, NOW);
		const rec = store.get('q1');
		expect(rec).toMatchObject({ attempts: 2, correct: 1 });
	});

	it('答错使熟练度归零', () => {
		let box = 0;
		for (let i = 0; i < 5; i++) box = store.record('q1', true, NOW).box;
		expect(box).toBe(MAX_BOX);
		expect(store.record('q1', false, NOW).box).toBe(0);
	});

	it('写入后可从同一后端重新载入', () => {
		store.record('q1', true, NOW);
		store.record('q2', false, NOW);

		const reloaded = new ProgressStore(backend);
		reloaded.load();
		expect(Object.keys(reloaded.records).sort()).toEqual(['q1', 'q2']);
		expect(reloaded.get('q1')?.box).toBe(1);
	});

	it('连击不跨会话保留', () => {
		store.record('q1', true, NOW);
		store.record('q2', true, NOW);
		expect(store.streak).toBe(2);

		const reloaded = new ProgressStore(backend);
		reloaded.load();
		expect(reloaded.streak).toBe(0);
		expect(reloaded.bestStreak).toBe(0);
	});

	it('load 幂等，重复调用不覆盖已有内存状态', () => {
		store.record('q1', true, NOW);
		store.load();
		store.load();
		expect(Object.keys(store.records)).toEqual(['q1']);
	});

	it('版本不匹配的旧数据被丢弃', () => {
		backend.write('ael-progress-v1', { version: 99, records: { old: { box: 3 } } });
		const fresh = new ProgressStore(backend);
		fresh.load();
		expect(fresh.records).toEqual({});
	});

	it('损坏数据不导致崩溃', () => {
		const broken: StorageBackend = {
			read: <T>(_k: string, fallback: T) => fallback,
			write: () => false,
			remove: () => {}
		};
		const fresh = new ProgressStore(broken);
		expect(() => fresh.load()).not.toThrow();
		expect(fresh.records).toEqual({});
	});

	it('存储写入失败时不影响内存状态', () => {
		const readOnly: StorageBackend = {
			read: <T>(_k: string, fallback: T) => fallback,
			write: () => false,
			remove: () => {}
		};
		const fresh = new ProgressStore(readOnly);
		fresh.load();
		expect(fresh.record('q1', true, NOW).box).toBe(1);
		expect(fresh.streak).toBe(1);
	});

	it('scheduleView 只暴露调度需要的字段', () => {
		store.record('q1', true, NOW);
		const view = store.scheduleView;
		expect(Object.keys(view.q1).sort()).toEqual(['box', 'dueAt']);
	});

	it('reset 清空内存与存储', () => {
		store.record('q1', true, NOW);
		store.reset();
		expect(store.records).toEqual({});
		expect(store.streak).toBe(0);

		const reloaded = new ProgressStore(backend);
		reloaded.load();
		expect(reloaded.records).toEqual({});
	});
});

describe('createMemoryBackend', () => {
	it('读写删基本行为正确', () => {
		const b = createMemoryBackend();
		expect(b.read('k', 'default')).toBe('default');
		expect(b.write('k', { a: 1 })).toBe(true);
		expect(b.read('k', null)).toEqual({ a: 1 });
		b.remove('k');
		expect(b.read('k', 'gone')).toBe('gone');
	});

	it('循环引用写入失败但不抛异常', () => {
		const b = createMemoryBackend();
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(b.write('k', cyclic)).toBe(false);
	});
});
