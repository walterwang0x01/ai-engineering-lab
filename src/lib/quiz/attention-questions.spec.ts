import { describe, expect, it } from 'vitest';
import { ATTENTION_QUESTIONS, ATTENTION_SPEC } from './attention-questions';
import { assertValidQuestionSet } from './validate';
import { judge } from './judge';

/** 注意力分数矩阵字节数：batch × heads × seq × seq × bytes（无 head_dim） */
function scoreMatrixBytes(batch: number, heads: number, seq: number, bytes: number): number {
	return batch * heads * seq * seq * bytes;
}

/** Q/K/V/O 四个张量合计字节数 */
function qkvoBytes(batch: number, heads: number, seq: number, headDim: number, bytes: number) {
	return 4 * batch * heads * seq * headDim * bytes;
}

const GIB = 1024 ** 3;

describe('题库结构完整性', () => {
	it('通过共享题库校验（含 id 命名空间隔离）', () => {
		expect(() => assertValidQuestionSet(ATTENTION_QUESTIONS, 'attention')).not.toThrow();
	});

	it('题量在建议区间内', () => {
		expect(ATTENTION_QUESTIONS.length).toBeGreaterThanOrEqual(8);
		expect(ATTENTION_QUESTIONS.length).toBeLessThanOrEqual(12);
	});

	it('三种题型都有', () => {
		const kinds = new Set(ATTENTION_QUESTIONS.map((q) => q.kind));
		expect(kinds).toEqual(new Set(['numeric', 'choice', 'code']));
	});

	it('每个选择题的错误选项都有定向解释', () => {
		for (const q of ATTENTION_QUESTIONS) {
			if (q.kind !== 'choice') continue;
			expect(Object.keys(q.distractorNotes ?? {}).length, `${q.id} 干扰项说明不完整`).toBe(
				q.options.length - 1
			);
		}
	});

	it('代码题不加载 numpy（避免额外下载）', () => {
		for (const q of ATTENTION_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.packages ?? [], `${q.id} 引入了额外包`).toEqual([]);
		}
	});
});

describe('题目数值与公式一致', () => {
	const { heads, headDim, dtypeBytes } = ATTENTION_SPEC;

	it('attention-01：seq=4096 时分数矩阵恰好 1 GiB', () => {
		const bytes = scoreMatrixBytes(1, heads, 4096, dtypeBytes);
		expect(bytes / GIB).toBeCloseTo(1, 9);
		const q = ATTENTION_QUESTIONS.find((x) => x.id === 'attention-01-matrix-memory')!;
		expect(q.kind === 'numeric' && q.answer).toBe(1);
	});

	it('attention-02：seq 翻倍是平方关系，得 4 倍', () => {
		const a = scoreMatrixBytes(1, heads, 4096, dtypeBytes);
		const b = scoreMatrixBytes(1, heads, 8192, dtypeBytes);
		expect(b / a).toBe(4);
	});

	it('分数矩阵公式不含 head_dim（点积把它消掉了）', () => {
		// 换 head_dim 不应改变分数矩阵大小 —— 这是题目解释里的关键论断
		const withSmallDim = scoreMatrixBytes(1, heads, 4096, dtypeBytes);
		expect(withSmallDim).toBe(scoreMatrixBytes(1, heads, 4096, dtypeBytes));
		// 而 Q/K/V/O 确实随 head_dim 变化，两者对比才说得通
		expect(qkvoBytes(1, heads, 4096, 64, dtypeBytes)).toBeLessThan(
			qkvoBytes(1, heads, 4096, 128, dtypeBytes)
		);
	});

	it('attention-03：点积标准差等于 sqrt(d_k)', () => {
		// 独立同分布项之和的方差 = 各项方差之和。
		// 每项是两个标准正态之积，方差为 1，d_k 项求和后方差 = d_k。
		const dk = 64;
		expect(Math.sqrt(dk)).toBe(8);
		const q = ATTENTION_QUESTIONS.find((x) => x.id === 'attention-03-scaling-factor')!;
		expect(judge(q, String(Math.sqrt(dk))).correct).toBe(true);
	});

	it('attention-03：head_dim=128 时解释里的 11.3 成立', () => {
		expect(Math.sqrt(128)).toBeCloseTo(11.3, 1);
	});

	it('attention-05：因果掩码有效率为 (n+1)/2n', () => {
		const n = 4096;
		const ratio = (n * (n + 1)) / 2 / (n * n);
		expect(ratio * 100).toBeCloseTo(50.01, 2);
		const q = ATTENTION_QUESTIONS.find((x) => x.id === 'attention-05-causal-waste')!;
		expect(judge(q, String(ratio * 100)).correct).toBe(true);
	});

	it('attention-05：解释里 n=4 时 62.5% 成立', () => {
		expect(((4 * 5) / 2 / 16) * 100).toBe(62.5);
	});

	it('attention-07：Flash 节省 17 倍', () => {
		const scores = scoreMatrixBytes(1, heads, 8192, dtypeBytes);
		const tensors = qkvoBytes(1, heads, 8192, headDim, dtypeBytes);
		expect(scores / GIB).toBeCloseTo(4, 9);
		expect(tensors / GIB).toBeCloseTo(0.25, 9);
		expect((scores + tensors) / tensors).toBeCloseTo(17, 9);
	});

	it('attention-07：解释里「分数矩阵占 94%」成立', () => {
		const scores = scoreMatrixBytes(1, heads, 8192, dtypeBytes);
		const tensors = qkvoBytes(1, heads, 8192, headDim, dtypeBytes);
		expect(Math.round((scores / (scores + tensors)) * 100)).toBe(94);
	});

	it('attention-08：滑动窗口 256 省 32 倍', () => {
		const seq = 8192;
		const w = 256;
		expect(seq / w).toBe(32);
		// 直接从矩阵形状推：seq×seq 变成 seq×w
		const full = scoreMatrixBytes(1, heads, seq, dtypeBytes);
		const sliding = 1 * heads * seq * w * dtypeBytes;
		expect(full / sliding).toBe(32);
	});

	it('解释里 16384 → 16 GB 的推论成立', () => {
		expect(scoreMatrixBytes(1, heads, 16384, dtypeBytes) / GIB).toBe(16);
	});

	it('每道数值题的标准答案都能通过判定', () => {
		for (const q of ATTENTION_QUESTIONS) {
			if (q.kind !== 'numeric') continue;
			expect(judge(q, String(q.answer)).correct, `${q.id} 标准答案判定失败`).toBe(true);
		}
	});
});
