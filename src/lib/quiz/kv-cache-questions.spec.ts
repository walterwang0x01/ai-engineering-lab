import { describe, expect, it } from 'vitest';
import { KV_CACHE_QUESTIONS, MODEL_SPECS } from './kv-cache-questions';
import { judge } from './judge';
import { assertValidQuestionSet } from './validate';

/** KV Cache 显存公式，单位 GiB。测试用它独立重算题目答案 */
function kvCacheGiB(p: {
	batch: number;
	seq: number;
	layers: number;
	kvHeads: number;
	headDim: number;
	bytes: number;
}): number {
	return (2 * p.batch * p.seq * p.layers * p.kvHeads * p.headDim * p.bytes) / 1024 ** 3;
}

describe('题库结构完整性', () => {
	// 结构性校验统一走共享校验器：id 唯一与前缀、非空题干解释、
	// 选项与容差合法、标准答案自洽，全部在 validate.ts 里。
	// 新增关卡的 spec 只需照抄这一条，即可获得同样的门禁。
	it('通过共享题库校验（含 id 命名空间隔离）', () => {
		expect(() => assertValidQuestionSet(KV_CACHE_QUESTIONS, 'kv-cache')).not.toThrow();
	});

	it('题量在建议区间内（8-12 道）', () => {
		expect(KV_CACHE_QUESTIONS.length).toBeGreaterThanOrEqual(8);
		expect(KV_CACHE_QUESTIONS.length).toBeLessThanOrEqual(12);
	});

	it('题型有搭配，不是清一色数值题', () => {
		const kinds = new Set(KV_CACHE_QUESTIONS.map((q) => q.kind));
		expect(kinds.size).toBeGreaterThan(1);
	});

	it('每个选择题的错误选项都有定向解释', () => {
		for (const q of KV_CACHE_QUESTIONS) {
			if (q.kind !== 'choice') continue;
			const wrongCount = q.options.length - 1;
			const noteCount = Object.keys(q.distractorNotes ?? {}).length;
			expect(noteCount, `${q.id} 的干扰项说明不完整`).toBe(wrongCount);
		}
	});
});

describe('题目数值与 KV Cache 公式一致', () => {
	const { llama3_8b, llama2_70b } = MODEL_SPECS;

	it('kv-01：8B GQA batch=1 seq=8192 fp16 应为 1 GB', () => {
		const v = kvCacheGiB({
			batch: 1,
			seq: 8192,
			layers: llama3_8b.layers,
			kvHeads: llama3_8b.gqaGroups,
			headDim: llama3_8b.headDim,
			bytes: 2
		});
		expect(v).toBeCloseTo(1, 6);
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-cache-01-gqa-baseline')!;
		expect(q.kind === 'numeric' && q.answer).toBe(1);
	});

	it('kv-02：8B MHA 同配置应为 4 GB', () => {
		const v = kvCacheGiB({
			batch: 1,
			seq: 8192,
			layers: llama3_8b.layers,
			kvHeads: llama3_8b.heads,
			headDim: llama3_8b.headDim,
			bytes: 2
		});
		expect(v).toBeCloseTo(4, 6);
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-cache-02-mha-contrast')!;
		expect(q.kind === 'numeric' && q.answer).toBe(4);
	});

	it('kv-03：节省倍数等于 heads / kv_heads', () => {
		expect(llama3_8b.heads / llama3_8b.gqaGroups).toBe(4);
	});

	it('kv-05：70B GQA batch=32 seq=4096 fp16 应为 40 GB', () => {
		const v = kvCacheGiB({
			batch: 32,
			seq: 4096,
			layers: llama2_70b.layers,
			kvHeads: llama2_70b.gqaGroups,
			headDim: llama2_70b.headDim,
			bytes: 2
		});
		expect(v).toBeCloseTo(40, 6);
	});

	it('kv-05 解释中的 MHA 对照值 320 GB 成立', () => {
		const v = kvCacheGiB({
			batch: 32,
			seq: 4096,
			layers: llama2_70b.layers,
			kvHeads: llama2_70b.heads,
			headDim: llama2_70b.headDim,
			bytes: 2
		});
		expect(v).toBeCloseTo(320, 6);
	});

	it('kv-06：int8 恰为 fp16 的一半', () => {
		const fp16 = kvCacheGiB({
			batch: 32,
			seq: 4096,
			layers: llama2_70b.layers,
			kvHeads: llama2_70b.gqaGroups,
			headDim: llama2_70b.headDim,
			bytes: 2
		});
		const int8 = kvCacheGiB({
			batch: 32,
			seq: 4096,
			layers: llama2_70b.layers,
			kvHeads: llama2_70b.gqaGroups,
			headDim: llama2_70b.headDim,
			bytes: 1
		});
		expect(int8).toBeCloseTo(fp16 / 2, 6);
		expect(int8).toBeCloseTo(20, 6);
	});

	it('kv-08：临界 batch 落在题目容差内', () => {
		const perBatch = kvCacheGiB({
			batch: 1,
			seq: 8192,
			layers: llama3_8b.layers,
			kvHeads: llama3_8b.gqaGroups,
			headDim: llama3_8b.headDim,
			bytes: 2
		});
		const crossover = llama3_8b.weightGiB / perBatch;
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-cache-08-crossover-batch')!;
		// 真实值 14.9，题目答案 15，容差 1 —— 真实值必须能判对
		expect(judge(q, String(crossover)).correct).toBe(true);
	});

	it('kv-10：容量规划结果落在题目容差内', () => {
		const perBatch = 1;
		const maxBatch = Math.floor((80 - llama3_8b.weightGiB - 8) / perBatch);
		expect(maxBatch).toBe(57);
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-cache-10-capacity-planning')!;
		expect(judge(q, String(maxBatch)).correct).toBe(true);
	});

	it('8B fp16 权重声明值与计算一致', () => {
		expect((8e9 * 2) / 1024 ** 3).toBeCloseTo(llama3_8b.weightGiB, 1);
	});
});
