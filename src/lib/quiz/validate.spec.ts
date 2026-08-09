import { describe, expect, it } from 'vitest';
import { assertValidQuestionSet, validateQuestionSet } from './validate';
import type { ChoiceQuestion, NumericQuestion, Question } from './types';

const LEVEL = 'demo';

function numeric(over: Partial<NumericQuestion> = {}): NumericQuestion {
	return {
		kind: 'numeric',
		id: 'demo-01-x',
		prompt: '题干',
		answer: 4,
		explanation: '解释',
		...over
	};
}

function choice(over: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
	return {
		kind: 'choice',
		id: 'demo-02-y',
		prompt: '题干',
		options: ['甲', '乙', '丙'],
		answerIndex: 1,
		explanation: '解释',
		...over
	};
}

/** 断言恰好命中某个问题描述 */
function problems(qs: Question[], levelId = LEVEL): string[] {
	return validateQuestionSet(qs, levelId).map((i) => i.problem);
}

describe('validateQuestionSet 通过的情况', () => {
	it('合规题库无问题', () => {
		expect(validateQuestionSet([numeric(), choice()], LEVEL)).toEqual([]);
	});

	it('带容差的小数答案能通过', () => {
		expect(problems([numeric({ answer: 20.5, tolerance: 0.5 })])).toEqual([]);
	});
});

describe('id 命名空间校验', () => {
	it('id 前缀不匹配关卡时报错', () => {
		const found = problems([numeric({ id: 'q1' })]);
		expect(found.some((p) => p.includes('必须以 "demo-" 开头'))).toBe(true);
	});

	it('id 重复被抓出', () => {
		const found = problems([numeric({ id: 'demo-01-a' }), numeric({ id: 'demo-01-a' })]);
		expect(found).toContain('id 重复');
	});

	it('前缀正确但后缀不同的 id 都合规', () => {
		expect(problems([numeric({ id: 'demo-01-a' }), numeric({ id: 'demo-02-b' })])).toEqual([]);
	});
});

describe('内容完整性校验', () => {
	it('空题干被抓出', () => {
		expect(problems([numeric({ prompt: '   ' })])).toContain('题干为空');
	});

	it('空解释被抓出', () => {
		expect(problems([numeric({ explanation: '' })])).toContain('解释为空');
	});

	it('空题库被抓出', () => {
		expect(problems([])).toContain('题库为空');
	});
});

describe('数值题校验', () => {
	it('负容差被抓出', () => {
		expect(problems([numeric({ tolerance: -1 })])).toContain('tolerance 不能为负');
	});

	it('负相对容差被抓出', () => {
		expect(problems([numeric({ relativeTolerance: -0.1 })])).toContain(
			'relativeTolerance 不能为负'
		);
	});

	it('非有限答案被抓出', () => {
		expect(problems([numeric({ answer: Number.NaN })])).toContain('answer 必须是有限数值');
	});
});

describe('选择题校验', () => {
	it('选项少于 2 个被抓出', () => {
		expect(problems([choice({ options: ['甲'], answerIndex: 0 })])).toContain('选项少于 2 个');
	});

	it('answerIndex 越界被抓出', () => {
		const found = problems([choice({ answerIndex: 9 })]);
		expect(found.some((p) => p.includes('超出选项范围'))).toBe(true);
	});

	it('空选项被抓出', () => {
		expect(problems([choice({ options: ['甲', '  ', '丙'] })])).toContain('存在空选项');
	});

	it('重复选项被抓出', () => {
		expect(problems([choice({ options: ['甲', '甲', '丙'] })])).toContain('存在重复选项');
	});

	it('distractorNotes 指向正确答案被抓出', () => {
		expect(problems([choice({ answerIndex: 1, distractorNotes: { 1: '不该在这' } })])).toContain(
			'distractorNotes 不应包含正确答案的下标'
		);
	});

	it('distractorNotes 下标越界被抓出', () => {
		const found = problems([choice({ distractorNotes: { 7: '越界' } })]);
		expect(found.some((p) => p.includes('下标 7 超出选项范围'))).toBe(true);
	});
});

describe('标准答案自洽校验', () => {
	it('容差为 0 的小数答案不被误判', () => {
		// judge 有 FLOAT_EPSILON 兜底，String(20.5) 解析回来精确相等
		expect(problems([numeric({ answer: 20.5, tolerance: 0 })])).toEqual([]);
	});

	it('浮点运算得来的答案不被误判', () => {
		// 0.1 + 0.2 === 0.30000000000000004，字符串化再解析仍是同一个值
		expect(problems([numeric({ answer: 0.1 + 0.2 })])).toEqual([]);
	});

	it('人为构造判定不过的题会被抓出', () => {
		// answerIndex 越界时 judge 返回 empty，标准答案自然不通过
		const found = problems([choice({ answerIndex: 5 })]);
		expect(found.some((p) => p.includes('标准答案无法通过判定引擎'))).toBe(true);
	});
});

describe('assertValidQuestionSet', () => {
	it('合规时不抛异常', () => {
		expect(() => assertValidQuestionSet([numeric(), choice()], LEVEL)).not.toThrow();
	});

	it('不合规时抛出含全部问题的可读错误', () => {
		let message = '';
		try {
			assertValidQuestionSet([numeric({ id: 'bad', prompt: '' })], LEVEL);
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toContain('题库 "demo" 存在');
		expect(message).toContain('[bad]');
		expect(message).toContain('题干为空');
	});
});
