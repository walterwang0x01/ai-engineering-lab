import { describe, expect, it } from 'vitest';
import { RAG_CHUNKING_ASSUMPTIONS, RAG_CHUNKING_QUESTIONS } from './rag-chunking-questions';
import { judge } from './judge';
import { assertValidQuestionSet } from './validate';

describe('题库结构完整性', () => {
	it('通过共享题库校验（含 id 命名空间隔离）', () => {
		expect(() => assertValidQuestionSet(RAG_CHUNKING_QUESTIONS, 'rag-chunking')).not.toThrow();
	});

	it('题量在建议区间内（8-10 道）', () => {
		expect(RAG_CHUNKING_QUESTIONS.length).toBeGreaterThanOrEqual(8);
		expect(RAG_CHUNKING_QUESTIONS.length).toBeLessThanOrEqual(10);
	});

	it('三种题型都有', () => {
		const kinds = new Set(RAG_CHUNKING_QUESTIONS.map((q) => q.kind));
		expect(kinds).toEqual(new Set(['numeric', 'choice', 'code']));
	});

	it('每个选择题的错误选项都有定向解释', () => {
		for (const q of RAG_CHUNKING_QUESTIONS) {
			if (q.kind !== 'choice') continue;
			const wrongCount = q.options.length - 1;
			const noteCount = Object.keys(q.distractorNotes ?? {}).length;
			expect(noteCount, `${q.id} 的干扰项说明不完整`).toBe(wrongCount);
		}
	});

	it('代码题不加载 numpy（避免额外下载）', () => {
		for (const q of RAG_CHUNKING_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.packages ?? [], `${q.id} 引入了额外包`).toEqual([]);
		}
	});

	it('代码题的 starterCode 都以 raise NotImplementedError 结尾，不能 return 0', () => {
		for (const q of RAG_CHUNKING_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.starterCode, `${q.id} 的 starterCode 必须抛 NotImplementedError`).toContain(
				'raise NotImplementedError'
			);
			expect(q.starterCode, `${q.id} 的 starterCode 不能用 return 0 糊弄`).not.toMatch(
				/return 0\b/
			);
		}
	});

	it('每道数值题的标准答案都能通过判定引擎', () => {
		for (const q of RAG_CHUNKING_QUESTIONS) {
			if (q.kind !== 'numeric') continue;
			expect(judge(q, String(q.answer)).correct, `${q.id} 标准答案判定失败`).toBe(true);
		}
	});
});

describe('题目数值与独立公式一致', () => {
	/** 独立实现的滑动窗口分块公式，不复用题库/参考答案的逻辑 */
	function computeChunkCount(totalChars: number, chunkSize: number, overlap: number): number {
		const stride = chunkSize - overlap;
		return Math.ceil((totalChars - chunkSize) / stride) + 1;
	}

	it('rag-chunking-01：chunk 数量 = ceil((总字符 - chunk_size) / 步长) + 1', () => {
		const n = computeChunkCount(10_000, 500, 50);
		expect(n).toBe(23);
		const q = RAG_CHUNKING_QUESTIONS.find((x) => x.id === 'rag-chunking-01-chunk-count')!;
		expect(q.kind === 'numeric' && q.answer).toBe(23);
		expect(judge(q, String(n)).correct).toBe(true);
	});

	it('rag-chunking-02：重叠额外 token = (chunk数-1) × overlap ÷ 字符/token 比例', () => {
		const n = computeChunkCount(10_000, 500, 50);
		const overlap = 50;
		const extraChars = (n - 1) * overlap;
		const extraTokens = extraChars / RAG_CHUNKING_ASSUMPTIONS.zhCharsPerToken;

		expect(extraChars).toBe(1100);
		expect(extraTokens).toBeCloseTo(733.33, 1);

		const q = RAG_CHUNKING_QUESTIONS.find((x) => x.id === 'rag-chunking-02-overlap-extra-tokens')!;
		expect(judge(q, String(extraTokens)).correct).toBe(true);
	});

	it('rag-chunking-03：向量存储量 = chunk数 × 维度 × 每维字节数 ÷ 1024²', () => {
		const bytesTotal = 8000 * 1536 * 4;
		const mb = bytesTotal / (1024 * 1024);

		expect(bytesTotal).toBe(49_152_000);
		expect(mb).toBeCloseTo(46.875, 2);

		const q = RAG_CHUNKING_QUESTIONS.find((x) => x.id === 'rag-chunking-03-vector-storage')!;
		expect(judge(q, String(mb)).correct).toBe(true);
	});

	it('rag-chunking-04：嵌入成本 = 总token数 / 1e6 × 单价，且总token数与分块粒度近似无关（overlap=0）', () => {
		const totalChars = 3_000_000;
		const chunkSize = 400;
		const nChunks = totalChars / chunkSize;
		const tokensPerChunk = chunkSize / RAG_CHUNKING_ASSUMPTIONS.zhCharsPerToken;
		const totalTokens = nChunks * tokensPerChunk;
		const cost = (totalTokens / 1_000_000) * RAG_CHUNKING_ASSUMPTIONS.embedPricePerMillion;

		// 交叉验证：overlap=0 时，总 token 数应等于 总字符数 / 字符每token（与分块粒度无关）
		const totalTokensDirect = totalChars / RAG_CHUNKING_ASSUMPTIONS.zhCharsPerToken;
		expect(totalTokens).toBeCloseTo(totalTokensDirect, 3);
		expect(cost).toBeCloseTo(0.04, 3);

		const q = RAG_CHUNKING_QUESTIONS.find((x) => x.id === 'rag-chunking-04-embedding-cost')!;
		expect(judge(q, String(cost)).correct).toBe(true);
	});

	it('rag-chunking-05：上下文窗口占用 = top_k×chunk_size÷字符每token÷窗口大小', () => {
		const topK = 6;
		const chunkSize = 400;
		const windowTokens = 8000;
		const retrievedTokens = (topK * chunkSize) / RAG_CHUNKING_ASSUMPTIONS.zhCharsPerToken;
		const occupancyPct = (retrievedTokens / windowTokens) * 100;

		expect(retrievedTokens).toBe(1600);
		expect(occupancyPct).toBeCloseTo(20, 3);

		const q = RAG_CHUNKING_QUESTIONS.find(
			(x) => x.id === 'rag-chunking-05-context-window-occupancy'
		)!;
		expect(judge(q, String(occupancyPct)).correct).toBe(true);
	});

	it('每道估算类题目的 explanation 都标注了"估算"', () => {
		const estimationQuestionIds = [
			'rag-chunking-02-overlap-extra-tokens',
			'rag-chunking-04-embedding-cost',
			'rag-chunking-05-context-window-occupancy'
		];
		for (const id of estimationQuestionIds) {
			const q = RAG_CHUNKING_QUESTIONS.find((x) => x.id === id)!;
			expect(q.explanation, `${id} 应标注为估算`).toMatch(/估算/);
		}
	});

	it('成本类题目的单价在题干中标注为假设值，不声称真实价格', () => {
		const costQuestionIds = ['rag-chunking-04-embedding-cost'];
		for (const id of costQuestionIds) {
			const q = RAG_CHUNKING_QUESTIONS.find((x) => x.id === id)!;
			expect(q.prompt, `${id} 的单价应标注为假设值`).toMatch(/假设值/);
		}
	});
});

describe('分块函数参考实现自洽（JS 独立复刻，交叉验证测试用例）', () => {
	/** 复刻 rag-chunking-c1 参考答案的逻辑，用于交叉验证测试用例本身没写错 */
	function chunkText(text: string, chunkSize: number, overlap: number): string[] {
		if (chunkSize <= overlap || overlap < 0) {
			throw new Error('要求 chunk_size > overlap >= 0');
		}
		if (text === '') return [];

		const stride = chunkSize - overlap;
		const chunks: string[] = [];
		let start = 0;
		while (start < text.length) {
			const piece = text.slice(start, start + chunkSize);
			if (piece === '') break;
			chunks.push(piece);
			if (start + chunkSize >= text.length) break;
			start += stride;
		}
		return chunks;
	}

	it('无重叠时按 chunk_size 整块切分', () => {
		expect(chunkText('abcdefghij', 5, 0)).toEqual(['abcde', 'fghij']);
	});

	it('有重叠时相邻块共享指定长度的内容', () => {
		const chunks = chunkText('abcdefghij', 4, 2);
		expect(chunks[0]).toBe('abcd');
		expect(chunks[1]).toBe('cdef');
	});

	it('块数与滑窗公式一致', () => {
		const text = 'x'.repeat(97);
		const chunkSize = 10;
		const overlap = 3;
		const stride = chunkSize - overlap;
		const chunks = chunkText(text, chunkSize, overlap);
		const expectedN = Math.ceil((text.length - chunkSize) / stride) + 1;
		expect(chunks.length).toBe(expectedN);
	});

	it('空字符串输入返回空数组', () => {
		expect(chunkText('', 5, 1)).toEqual([]);
	});
});
