import { describe, expect, it } from 'vitest';
import { KV_CACHE_QUESTIONS, MODEL_SPECS } from './kv-cache-questions';
import { judge } from './judge';

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
	it('id 全局唯一', () => {
		const ids = KV_CACHE_QUESTIONS.map((q) => q.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('每道题都有非空题干和解释', () => {
		for (const q of KV_CACHE_QUESTIONS) {
			expect(q.prompt.trim(), `${q.id} 题干为空`).not.toBe('');
			expect(q.explanation.trim(), `${q.id} 解释为空`).not.toBe('');
		}
	});

	it('选择题的正确答案下标在选项范围内', () => {
		for (const q of KV_CACHE_QUESTIONS) {
			if (q.kind !== 'choice') continue;
			expect(q.options.length, `${q.id} 选项少于 2 个`).toBeGreaterThanOrEqual(2);
			expect(q.answerIndex).toBeGreaterThanOrEqual(0);
			expect(q.answerIndex).toBeLessThan(q.options.length);
		}
	});

	it('选择题的干扰项说明不指向正确答案', () => {
		for (const q of KV_CACHE_QUESTIONS) {
			if (q.kind !== 'choice' || !q.distractorNotes) continue;
			for (const idx of Object.keys(q.distractorNotes).map(Number)) {
				expect(idx, `${q.id} 的 distractorNotes 不应包含正确答案`).not.toBe(q.answerIndex);
				expect(idx).toBeLessThan(q.options.length);
			}
		}
	});

	it('数值题的容差非负', () => {
		for (const q of KV_CACHE_QUESTIONS) {
			if (q.kind !== 'numeric') continue;
			expect(q.tolerance ?? 0).toBeGreaterThanOrEqual(0);
			expect(q.relativeTolerance ?? 0).toBeGreaterThanOrEqual(0);
		}
	});

	it('每道题的正确答案都能通过判定引擎', () => {
		for (const q of KV_CACHE_QUESTIONS) {
			const answer = q.kind === 'numeric' ? String(q.answer) : q.answerIndex;
			expect(judge(q, answer).correct, `${q.id} 的标准答案未通过自身判定`).toBe(true);
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
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-01-gqa-baseline')!;
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
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-02-mha-contrast')!;
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
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-08-crossover-batch')!;
		// 真实值 14.9，题目答案 15，容差 1 —— 真实值必须能判对
		expect(judge(q, String(crossover)).correct).toBe(true);
	});

	it('kv-10：容量规划结果落在题目容差内', () => {
		const perBatch = 1;
		const maxBatch = Math.floor((80 - llama3_8b.weightGiB - 8) / perBatch);
		expect(maxBatch).toBe(57);
		const q = KV_CACHE_QUESTIONS.find((x) => x.id === 'kv-10-capacity-planning')!;
		expect(judge(q, String(maxBatch)).correct).toBe(true);
	});

	it('8B fp16 权重声明值与计算一致', () => {
		expect((8e9 * 2) / 1024 ** 3).toBeCloseTo(llama3_8b.weightGiB, 1);
	});
});
