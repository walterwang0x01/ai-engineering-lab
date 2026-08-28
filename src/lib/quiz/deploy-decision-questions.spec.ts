import { describe, expect, it } from 'vitest';
import { DEPLOY_DECISION_QUESTIONS, DEPLOY_SCENARIO } from './deploy-decision-questions';
import { judge } from './judge';
import { assertValidQuestionSet } from './validate';

const S = DEPLOY_SCENARIO;

describe('题库结构完整性', () => {
	it('通过共享题库校验（含 id 命名空间隔离）', () => {
		expect(() =>
			assertValidQuestionSet(DEPLOY_DECISION_QUESTIONS, 'deploy-decision')
		).not.toThrow();
	});

	it('至少 8 道题（设计要求 8-12）', () => {
		expect(DEPLOY_DECISION_QUESTIONS.length).toBeGreaterThanOrEqual(8);
	});

	it('包含数值题和选择题的混合（跨关卡需要多种题型）', () => {
		const kinds = new Set(DEPLOY_DECISION_QUESTIONS.map((q) => q.kind));
		expect(kinds.has('numeric')).toBe(true);
		expect(kinds.has('choice')).toBe(true);
	});
});

describe('数值题独立重算', () => {
	it('Q1: KV Cache 总显存 = 40 GB', () => {
		const bytes = 2 * S.batch * S.seqLen * S.layers * S.gqaGroups * S.headDim * 2;
		// 2 × 32 × 4096 × 80 × 8 × 128 × 2 = 42,949,672,960 bytes ≈ 42.95 GB
		// 但用 GiB 换算: bytes / 1024³ = 40.0 GiB
		// 题目说的是 GB（工程语境下通常指 GiB），验证在容差范围内
		const giB = bytes / 1024 ** 3;
		expect(giB).toBeCloseTo(40.0, 0);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-01-kv-cache-total')!;
		expect(q.kind === 'numeric' && judge(q, giB).correct).toBe(true);
	});

	it('Q3: 注意力 QK^T 总 TFLOPS', () => {
		const perHead = 2 * S.seqLen ** 2 * S.headDim;
		const total = perHead * S.heads * S.layers;
		const tflops = total / 1e12;
		expect(tflops).toBeCloseTo(21.99, 1);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-03-attention-flops')!;
		expect(q.kind === 'numeric' && judge(q, tflops).correct).toBe(true);
	});

	it('Q4: 缩放因子 1/√128', () => {
		const scale = 1 / Math.sqrt(S.headDim);
		expect(scale).toBeCloseTo(0.0884, 4);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-04-scale-factor')!;
		expect(q.kind === 'numeric' && judge(q, scale).correct).toBe(true);
	});

	it('Q5: INT8 量化后 KV Cache = 20 GB', () => {
		const bytes = 2 * S.batch * S.seqLen * S.layers * S.gqaGroups * S.headDim * 1; // 1 byte per element
		const giB = bytes / 1024 ** 3;
		expect(giB).toBeCloseTo(20.0, 0);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-05-int8-kv-saving')!;
		expect(q.kind === 'numeric' && judge(q, giB).correct).toBe(true);
	});

	it('Q6: 中文文档 token 数 = 6000', () => {
		const tokens = 9000 / 1.5;
		expect(tokens).toBe(6000);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-06-token-cost')!;
		expect(q.kind === 'numeric' && judge(q, tokens).correct).toBe(true);
	});

	it('Q7: batch 减半 → KV Cache 减半 = 20 GB', () => {
		const bytes = 2 * 16 * S.seqLen * S.layers * S.gqaGroups * S.headDim * 2;
		const giB = bytes / 1024 ** 3;
		expect(giB).toBeCloseTo(20.0, 0);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-07-halve-batch')!;
		expect(q.kind === 'numeric' && judge(q, giB).correct).toBe(true);
	});

	it('Q8: RAG 分块数 = 2223', () => {
		const chunkSize = 500;
		const overlap = 50;
		const totalChars = 1_000_000;
		const step = chunkSize - overlap; // 450
		const chunks = Math.ceil((totalChars - overlap) / step);
		expect(chunks).toBe(2223);
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-08-rag-chunks')!;
		expect(q.kind === 'numeric' && judge(q, chunks).correct).toBe(true);
	});

	it('Q9: RAG top-5 上下文 tokens = 1967', () => {
		const retrievalTokens = Math.round((5 * 500) / 1.5); // 1667
		const total = 200 + retrievalTokens + 100; // 1967
		expect(total).toBe(1967);
		const q = DEPLOY_DECISION_QUESTIONS.find(
			(q) => q.id === 'deploy-decision-09-rag-context-tokens'
		)!;
		expect(q.kind === 'numeric' && judge(q, total).correct).toBe(true);
	});
});

describe('选择题答案自洽', () => {
	it('Q2: 需要 pipeline parallelism', () => {
		const q = DEPLOY_DECISION_QUESTIONS.find((q) => q.id === 'deploy-decision-02-fits-in-memory')!;
		expect(q.kind === 'choice' && judge(q, q.answerIndex).correct).toBe(true);
	});

	it('Q10: SwiGLU 没有死区', () => {
		const q = DEPLOY_DECISION_QUESTIONS.find(
			(q) => q.id === 'deploy-decision-10-dead-relu-inference'
		)!;
		expect(q.kind === 'choice' && judge(q, q.answerIndex).correct).toBe(true);
	});
});
