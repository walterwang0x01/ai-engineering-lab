import { describe, expect, it } from 'vitest';
import { BACKPROP_QUESTIONS, BACKPROP_NET, BACKPROP_INPUT } from './backprop-questions';
import { judge } from './judge';
import { assertValidQuestionSet } from './validate';

/**
 * 独立实现的前向 + 反向传播，不依赖 backprop-questions.ts 里的任何叙述性数字。
 *
 * 网络：
 *   z1 = w11*x1 + w12*x2 + b1     h1 = ReLU(z1)
 *   z2 = w21*x1 + w22*x2 + b2     h2 = ReLU(z2)
 *   out = v1*h1 + v2*h2 + c
 *   L = (out - y)^2
 */
function relu(z: number): number {
	return Math.max(0, z);
}

function reluGrad(z: number): number {
	return z > 0 ? 1 : 0;
}

interface NetParams {
	w11: number;
	w12: number;
	b1: number;
	w21: number;
	w22: number;
	b2: number;
	v1: number;
	v2: number;
	c: number;
}

function forward(p: NetParams, x1: number, x2: number, y: number) {
	const z1 = p.w11 * x1 + p.w12 * x2 + p.b1;
	const z2 = p.w21 * x1 + p.w22 * x2 + p.b2;
	const h1 = relu(z1);
	const h2 = relu(z2);
	const out = p.v1 * h1 + p.v2 * h2 + p.c;
	const L = (out - y) ** 2;
	return { z1, z2, h1, h2, out, L };
}

function backward(p: NetParams, x1: number, x2: number, fwd: ReturnType<typeof forward>) {
	const dOut = 2 * (fwd.out - BACKPROP_INPUT.y);
	const dH1 = dOut * p.v1;
	const dH2 = dOut * p.v2;
	const dZ1 = dH1 * reluGrad(fwd.z1);
	const dZ2 = dH2 * reluGrad(fwd.z2);
	return {
		dOut,
		dH1,
		dH2,
		dZ1,
		dZ2,
		dW11: dZ1 * x1,
		dW12: dZ1 * x2,
		dB1: dZ1,
		dW21: dZ2 * x1,
		dW22: dZ2 * x2,
		dB2: dZ2
	};
}

/** 数值微分，用于交叉验证解析梯度（独立于 backward 的第二条证据） */
function numericalGrad(
	p: NetParams,
	x1: number,
	x2: number,
	y: number,
	key: keyof NetParams,
	eps = 1e-6
): number {
	const plus = { ...p, [key]: p[key] + eps };
	const minus = { ...p, [key]: p[key] - eps };
	const Lplus = forward(plus, x1, x2, y).L;
	const Lminus = forward(minus, x1, x2, y).L;
	return (Lplus - Lminus) / (2 * eps);
}

const NET: NetParams = { ...BACKPROP_NET };
const { x1, x2, y } = BACKPROP_INPUT;

describe('题库结构完整性', () => {
	it('通过共享题库校验（含 id 命名空间隔离）', () => {
		expect(() => assertValidQuestionSet(BACKPROP_QUESTIONS, 'backprop')).not.toThrow();
	});

	it('题量在建议区间内（8-10 道）', () => {
		expect(BACKPROP_QUESTIONS.length).toBeGreaterThanOrEqual(8);
		expect(BACKPROP_QUESTIONS.length).toBeLessThanOrEqual(10);
	});

	it('三种题型都有', () => {
		const kinds = new Set(BACKPROP_QUESTIONS.map((q) => q.kind));
		expect(kinds).toEqual(new Set(['numeric', 'choice', 'code']));
	});

	it('每个选择题的错误选项都有定向解释', () => {
		for (const q of BACKPROP_QUESTIONS) {
			if (q.kind !== 'choice') continue;
			const wrongCount = q.options.length - 1;
			const noteCount = Object.keys(q.distractorNotes ?? {}).length;
			expect(noteCount, `${q.id} 的干扰项说明不完整`).toBe(wrongCount);
		}
	});

	it('代码题不加载额外包（纯标准库）', () => {
		for (const q of BACKPROP_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.packages ?? [], `${q.id} 引入了额外包`).toEqual([]);
		}
	});

	it('代码题 starterCode 必须抛 NotImplementedError，不能是恒真的 return', () => {
		for (const q of BACKPROP_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.starterCode, `${q.id} 的 starterCode 必须包含 NotImplementedError`).toContain(
				'NotImplementedError'
			);
		}
	});

	it('代码题 starterCode 与 solutionCode 不同', () => {
		for (const q of BACKPROP_QUESTIONS) {
			if (q.kind !== 'code') continue;
			expect(q.starterCode.trim()).not.toBe(q.solutionCode.trim());
		}
	});
});

describe('前向传播与本关网络参数一致', () => {
	it('z1 = 1.7（存活），z2 = -0.4（死亡）', () => {
		const fwd = forward(NET, x1, x2, y);
		expect(fwd.z1).toBeCloseTo(1.7, 9);
		expect(fwd.z2).toBeCloseTo(-0.4, 9);
		expect(fwd.h1).toBeCloseTo(1.7, 9);
		expect(fwd.h2).toBe(0);
	});

	it('out = 3.5，L = 6.25', () => {
		const fwd = forward(NET, x1, x2, y);
		expect(fwd.out).toBeCloseTo(3.5, 9);
		expect(fwd.L).toBeCloseTo(6.25, 9);
	});
});

describe('题目数值与反向传播公式一致', () => {
	it('backprop-01：dL/dout 应为 5', () => {
		const fwd = forward(NET, x1, x2, y);
		const bwd = backward(NET, x1, x2, fwd);
		expect(bwd.dOut).toBeCloseTo(5, 9);
		const q = BACKPROP_QUESTIONS.find((v) => v.id === 'backprop-01-loss-grad')!;
		expect(q.kind === 'numeric' && q.answer).toBe(5);
	});

	it('backprop-02：dL/dw11 应为 10（存活神经元）', () => {
		const fwd = forward(NET, x1, x2, y);
		const bwd = backward(NET, x1, x2, fwd);
		expect(bwd.dW11).toBeCloseTo(10, 9);
		// 数值微分交叉验证
		expect(bwd.dW11).toBeCloseTo(numericalGrad(NET, x1, x2, y, 'w11'), 4);
		const q = BACKPROP_QUESTIONS.find((v) => v.id === 'backprop-02-alive-weight-grad')!;
		expect(q.kind === 'numeric' && q.answer).toBe(10);
	});

	it('backprop-03：dL/dz2 应为 0（死亡神经元，即使上游误差非零）', () => {
		const fwd = forward(NET, x1, x2, y);
		const bwd = backward(NET, x1, x2, fwd);
		// 上游误差 dH2 本身不为 0，但乘上 reluGrad(z2)=0 后归零
		expect(bwd.dH2).not.toBe(0);
		// JS 里 -5 * 0 = -0，语义上等同于 0，用 toBeCloseTo 而非严格 Object.is 比较
		expect(bwd.dZ2).toBeCloseTo(0, 9);
		const q = BACKPROP_QUESTIONS.find((v) => v.id === 'backprop-03-dead-relu-grad')!;
		expect(q.kind === 'numeric' && q.answer).toBe(0);
	});

	it('backprop-04：dL/dw21 应为 0（死亡神经元的权重梯度）', () => {
		const fwd = forward(NET, x1, x2, y);
		const bwd = backward(NET, x1, x2, fwd);
		expect(bwd.dW21).toBeCloseTo(0, 9);
		expect(bwd.dW22).toBeCloseTo(0, 9);
		expect(bwd.dB2).toBeCloseTo(0, 9);
		// 数值微分交叉验证：死亡神经元的梯度在数值上也应接近 0
		expect(Math.abs(numericalGrad(NET, x1, x2, y, 'w21'))).toBeLessThan(1e-4);
		const q = BACKPROP_QUESTIONS.find((v) => v.id === 'backprop-04-dead-relu-weight-grad')!;
		expect(q.kind === 'numeric' && q.answer).toBe(0);
	});

	it('backprop-05：临界 x1 ≈ 2.33（令 z2 = 0 反解）', () => {
		// 独立反解，不复用 backward 的任何中间量
		const criticalX1 = (0 - NET.w22 * x2 - NET.b2) / NET.w21;
		expect(criticalX1).toBeCloseTo(2.3333333333, 6);

		// 验证临界点确实让 z2 归零
		const z2AtCritical = NET.w21 * criticalX1 + NET.w22 * x2 + NET.b2;
		expect(z2AtCritical).toBeCloseTo(0, 9);

		const q = BACKPROP_QUESTIONS.find((v) => v.id === 'backprop-05-revival-threshold')!;
		expect(judge(q, String(criticalX1)).correct).toBe(true);
	});

	it('所有数值题的标准答案都能通过判定引擎', () => {
		for (const q of BACKPROP_QUESTIONS) {
			if (q.kind !== 'numeric') continue;
			expect(judge(q, String(q.answer)).correct, `${q.id} 标准答案判定失败`).toBe(true);
		}
	});

	it('梯度校验：解析解与数值微分在全部参数上一致（独立验证反向传播实现本身无误）', () => {
		const keys: (keyof NetParams)[] = ['w11', 'w12', 'b1', 'w21', 'w22', 'b2', 'v1', 'v2', 'c'];
		const fwd = forward(NET, x1, x2, y);
		const bwd = backward(NET, x1, x2, fwd);
		const analytic: Record<string, number> = {
			w11: bwd.dW11,
			w12: bwd.dW12,
			b1: bwd.dB1,
			w21: bwd.dW21,
			w22: bwd.dW22,
			b2: bwd.dB2,
			v1: fwd.h1 * bwd.dOut,
			v2: fwd.h2 * bwd.dOut,
			c: bwd.dOut
		};
		for (const key of keys) {
			const num = numericalGrad(NET, x1, x2, y, key);
			expect(analytic[key]).toBeCloseTo(num, 3);
		}
	});
});

describe('死亡 ReLU 现象在本关网络里真实存在', () => {
	it('z2 在多组不同输入下持续为负（不是单点偶然，但本关题目只使用固定输入）', () => {
		const samples: Array<[number, number]> = [
			[1, 2],
			[-1, 1],
			[2, -1],
			[0.5, 0.5]
		];
		for (const [a, b] of samples) {
			const z2 = NET.w21 * a + NET.w22 * b + NET.b2;
			expect(z2).toBeLessThan(0);
		}
	});

	it('h1 与 h2 在固定输入下分处 ReLU 两侧（验证"同层分化"的叙述成立）', () => {
		const fwd = forward(NET, x1, x2, y);
		expect(fwd.z1).toBeGreaterThan(0);
		expect(fwd.z2).toBeLessThan(0);
	});
});
