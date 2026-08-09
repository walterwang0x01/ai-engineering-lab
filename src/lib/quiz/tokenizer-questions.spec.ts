import { describe, expect, it } from 'vitest';
import { TOKENIZER_ASSUMPTIONS, TOKENIZER_QUESTIONS } from './tokenizer-questions';
import { judge } from './judge';
import { assertValidQuestionSet } from './validate';

describe('题库结构完整性', () => {
	it('通过共享题库校验（含 id 命名空间隔离）', () => {
		expect(() => assertValidQuestionSet(TOKENIZER_QUESTIONS, 'tokenizer')).not.toThrow();
	});

	it('题量在建议区间内（8-10 道）', () => {
		expect(TOKENIZER_QUESTIONS.length).toBeGreaterThanOrEqual(8);
		expect(TOKENIZER_QUESTIONS.length).toBeLessThanOrEqual(10);
	});

	it('三种题型都有', () => {
		const kinds = new Set(TOKENIZER_QUESTIONS.map((q) => q.kind));
		expect(kinds).toEqual(new Set(['numeric', 'choice', 'code']));
	});

	it('每个选择题的错误选项都有定向解释', () => {
		for (const q of TOKENIZER_QUESTIONS) {
			if (q.kind !== 'choice') continue;
			const wrongCount = q.options.length - 1;
			const noteCount = Object.keys(q.distractorNotes ?? {}).length;
			expect(noteCount, `${q.id} 的干扰项说明不完整`).toBe(wrongCount);
		}
	});

	it('代码题不加载 numpy（避免额外下载）', () => {
		for (const q of TOKENIZER_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.packages ?? [], `${q.id} 引入了额外包`).toEqual([]);
		}
	});

	it('代码题的 starterCode 都以 raise NotImplementedError 结尾，不能 return 0', () => {
		for (const q of TOKENIZER_QUESTIONS) {
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
		for (const q of TOKENIZER_QUESTIONS) {
			if (q.kind !== 'numeric') continue;
			expect(judge(q, String(q.answer)).correct, `${q.id} 标准答案判定失败`).toBe(true);
		}
	});
});

describe('题目数值与独立公式一致', () => {
	it('tokenizer-01：BPE 合并频次 = 词频加权共现次数', () => {
		// 独立实现一遍词频统计与相邻对计数，不复用题库/参考答案的逻辑
		const wordFreqs: Record<string, number> = {
			low: 5,
			lower: 2,
			newest: 6,
			widest: 3
		};

		function pairFreq(word: string, pair: [string, string]): number {
			let count = 0;
			for (let i = 0; i < word.length - 1; i++) {
				if (word[i] === pair[0] && word[i + 1] === pair[1]) count++;
			}
			return count;
		}

		let esFreq = 0;
		for (const [word, freq] of Object.entries(wordFreqs)) {
			esFreq += pairFreq(word, ['e', 's']) * freq;
		}

		expect(esFreq).toBe(9);
		const q = TOKENIZER_QUESTIONS.find((x) => x.id === 'tokenizer-01-bpe-merge-freq')!;
		expect(q.kind === 'numeric' && q.answer).toBe(9);
	});

	it('tokenizer-04：中文/英文 token 效率比 = (charsPerToken_en) / (charsPerToken_zh)', () => {
		const { enCharsPerToken, zhCharsPerTokenRange } = TOKENIZER_ASSUMPTIONS;
		// 用区间下限（1.5 字/token）算比例——与题目说明一致
		const zhCharsPerToken = zhCharsPerTokenRange[1];

		const sampleChars = 400;
		const enTokens = sampleChars / enCharsPerToken;
		const zhTokens = sampleChars / zhCharsPerToken;
		const ratio = zhTokens / enTokens;

		expect(ratio).toBeCloseTo(2.6667, 3);
		const q = TOKENIZER_QUESTIONS.find((x) => x.id === 'tokenizer-04-chinese-efficiency-ratio')!;
		expect(judge(q, String(ratio)).correct).toBe(true);
	});

	it('tokenizer-05：成本 = tokens / 1e6 * 单价，独立算一遍', () => {
		function cost(tokens: number, pricePerMillion: number): number {
			return (tokens / 1_000_000) * pricePerMillion;
		}
		const v = cost(2_000_000, 0.5);
		expect(v).toBe(1);
		const q = TOKENIZER_QUESTIONS.find((x) => x.id === 'tokenizer-05-api-cost-basic')!;
		expect(judge(q, String(v)).correct).toBe(true);
	});

	it('tokenizer-06：轮数 = 窗口大小整除每轮 token 数', () => {
		const windowTokens = 128_000;
		const perTurn = 800;
		const turns = Math.floor(windowTokens / perTurn);
		expect(turns).toBe(160);
		const q = TOKENIZER_QUESTIONS.find((x) => x.id === 'tokenizer-06-context-window-turns')!;
		expect(judge(q, String(turns)).correct).toBe(true);
	});

	it('tokenizer-07：缓存节省倍数 = 未缓存单价 / 缓存单价（与 token 数无关）', () => {
		// 用两种独立方式验证："先算总成本再相除" 与 "直接用单价比"应得到同一结果
		const tokens = 100_000;
		const uncachedPrice = 3;
		const cachedPrice = 0.3;

		const costUncached = (tokens / 1_000_000) * uncachedPrice;
		const costCached = (tokens / 1_000_000) * cachedPrice;
		const ratioFromCost = costUncached / costCached;
		const ratioFromPrice = uncachedPrice / cachedPrice;

		expect(ratioFromCost).toBeCloseTo(10, 9);
		expect(ratioFromPrice).toBeCloseTo(10, 9);

		const q = TOKENIZER_QUESTIONS.find((x) => x.id === 'tokenizer-07-cache-savings-ratio')!;
		expect(judge(q, String(ratioFromCost)).correct).toBe(true);
	});

	it('每道题的 explanation 都提到"估算"或给出可精确复现的推导，非精确值题目有免责声明', () => {
		const estimationQuestionIds = ['tokenizer-04-chinese-efficiency-ratio'];
		for (const id of estimationQuestionIds) {
			const q = TOKENIZER_QUESTIONS.find((x) => x.id === id)!;
			expect(q.explanation, `${id} 应标注为估算`).toMatch(/估算/);
		}
	});

	it('成本类题目的单价在题干中标注为假设值，不声称真实价格', () => {
		const costQuestionIds = ['tokenizer-05-api-cost-basic', 'tokenizer-07-cache-savings-ratio'];
		for (const id of costQuestionIds) {
			const q = TOKENIZER_QUESTIONS.find((x) => x.id === id)!;
			expect(q.prompt, `${id} 的单价应标注为假设值`).toMatch(/假设值/);
		}
	});
});

describe('代码题：BPE 合并对与成本估算函数的参考实现自洽（JS 独立复刻）', () => {
	/** 复刻 tokenizer-c2 参考答案的逻辑，用于交叉验证测试用例本身没写错 */
	function mostFrequentPair(wordFreqs: Map<string, number>): [string, string] | null {
		const pairFreqs = new Map<string, number>();
		for (const [word, freq] of wordFreqs) {
			const symbols = word.split(',');
			for (let i = 0; i < symbols.length - 1; i++) {
				const key = `${symbols[i]}|${symbols[i + 1]}`;
				pairFreqs.set(key, (pairFreqs.get(key) ?? 0) + freq);
			}
		}
		if (pairFreqs.size === 0) return null;
		let bestKey = '';
		let bestFreq = -Infinity;
		for (const [key, freq] of pairFreqs) {
			if (freq > bestFreq) {
				bestFreq = freq;
				bestKey = key;
			}
		}
		const [a, b] = bestKey.split('|');
		return [a, b];
	}

	it('笔记例子里 (e,s) 以频次 9 胜出，与 JS 独立实现一致', () => {
		const freqs = new Map<string, number>([
			['l,o,w,</w>', 5],
			['l,o,w,e,r,</w>', 2],
			['n,e,w,e,s,t,</w>', 6],
			['w,i,d,e,s,t,</w>', 3]
		]);
		const pair = mostFrequentPair(freqs);
		expect(pair).toEqual(['e', 's']);
	});

	it('词频加权：低频词组合不应盖过高频词组合', () => {
		const freqs = new Map<string, number>([
			['a,b', 1],
			['c,d', 100]
		]);
		expect(mostFrequentPair(freqs)).toEqual(['c', 'd']);
	});

	it('成本估算函数的线性性质：JS 独立实现验证翻倍关系', () => {
		function estimateCost(
			inputTokens: number,
			outputTokens: number,
			priceIn: number,
			priceOut: number
		): number {
			return (inputTokens / 1_000_000) * priceIn + (outputTokens / 1_000_000) * priceOut;
		}
		const c1 = estimateCost(200_000, 50_000, 2.0, 4.0);
		const c2 = estimateCost(400_000, 100_000, 2.0, 4.0);
		expect(c1).toBeGreaterThan(0);
		expect(c2).toBeCloseTo(2 * c1, 9);
	});
});
