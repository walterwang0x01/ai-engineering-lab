import { describe, expect, it } from 'vitest';
import { judge, judgeChoice, judgeNumeric, parseNumeric } from './judge';
import type { ChoiceQuestion, NumericQuestion } from './types';

describe('parseNumeric', () => {
	it('解析普通整数与小数', () => {
		expect(parseNumeric('20')).toBe(20);
		expect(parseNumeric('20.5')).toBe(20.5);
		expect(parseNumeric('.5')).toBe(0.5);
	});

	it('容忍前后空白', () => {
		expect(parseNumeric('  4  ')).toBe(4);
	});

	it('容忍单位后缀', () => {
		expect(parseNumeric('40GB')).toBe(40);
		expect(parseNumeric('20 GB')).toBe(20);
		expect(parseNumeric('4倍')).toBe(4);
		expect(parseNumeric('5%')).toBe(5);
	});

	it('容忍千分位逗号', () => {
		expect(parseNumeric('1,024')).toBe(1024);
		expect(parseNumeric('1,048,576')).toBe(1048576);
	});

	it('容忍全角数字', () => {
		expect(parseNumeric('２０')).toBe(20);
	});

	it('容忍前导近似符号', () => {
		expect(parseNumeric('约 20')).toBe(20);
		expect(parseNumeric('≈20')).toBe(20);
		expect(parseNumeric('=20')).toBe(20);
	});

	it('解析负数与科学计数法', () => {
		expect(parseNumeric('-0.7')).toBe(-0.7);
		expect(parseNumeric('1.5e3')).toBe(1500);
		expect(parseNumeric('2E-2')).toBe(0.02);
	});

	it('无法解析时返回 null', () => {
		expect(parseNumeric('')).toBeNull();
		expect(parseNumeric('   ')).toBeNull();
		expect(parseNumeric('不知道')).toBeNull();
		expect(parseNumeric('abc')).toBeNull();
	});

	it('非字符串输入返回 null', () => {
		expect(parseNumeric(null as unknown as string)).toBeNull();
		expect(parseNumeric(undefined as unknown as string)).toBeNull();
	});
});

describe('judgeNumeric', () => {
	const exact: NumericQuestion = {
		kind: 'numeric',
		id: 'q-exact',
		prompt: '32 个查询头分 8 组，KV Cache 相比 MHA 节省几倍？',
		answer: 4,
		explanation: '32 / 8 = 4'
	};

	it('精确命中判对', () => {
		const r = judgeNumeric(exact, '4');
		expect(r).toMatchObject({ correct: true, verdict: 'exact', parsed: 4 });
	});

	it('带单位仍判对', () => {
		expect(judgeNumeric(exact, '4 倍').correct).toBe(true);
	});

	it('错误答案判错并给出相对误差', () => {
		const r = judgeNumeric(exact, '8');
		expect(r.correct).toBe(false);
		expect(r.verdict).toBe('wrong');
		expect(r.relativeError).toBe(1);
	});

	it('未作答返回 empty', () => {
		expect(judgeNumeric(exact, '').verdict).toBe('empty');
		expect(judgeNumeric(exact, '   ').verdict).toBe('empty');
	});

	it('填了非数字返回 unparseable', () => {
		expect(judgeNumeric(exact, '不知道').verdict).toBe('unparseable');
	});

	const withAbs: NumericQuestion = {
		kind: 'numeric',
		id: 'q-abs',
		prompt: '显存占用约多少 GB？',
		answer: 20,
		tolerance: 0.5,
		explanation: '略'
	};

	it('绝对容差内判对', () => {
		expect(judgeNumeric(withAbs, '20.4').correct).toBe(true);
		expect(judgeNumeric(withAbs, '19.6').correct).toBe(true);
	});

	it('绝对容差外判错', () => {
		expect(judgeNumeric(withAbs, '20.8').correct).toBe(false);
	});

	it('容差边界值判对', () => {
		expect(judgeNumeric(withAbs, '20.5').correct).toBe(true);
	});

	const withRel: NumericQuestion = {
		kind: 'numeric',
		id: 'q-rel',
		prompt: '显存占用约多少 GB？',
		answer: 128,
		relativeTolerance: 0.02,
		explanation: '略'
	};

	it('相对容差内判对', () => {
		expect(judgeNumeric(withRel, '130').correct).toBe(true);
	});

	it('相对容差外判错', () => {
		expect(judgeNumeric(withRel, '140').correct).toBe(false);
	});

	it('答案为 0 时不计算相对误差，只看绝对容差', () => {
		const zero: NumericQuestion = {
			kind: 'numeric',
			id: 'q-zero',
			prompt: 'ReLU 在 z<0 处的导数是多少？',
			answer: 0,
			explanation: '略'
		};
		const hit = judgeNumeric(zero, '0');
		expect(hit.correct).toBe(true);
		expect(hit.relativeError).toBeUndefined();
		expect(judgeNumeric(zero, '1').correct).toBe(false);
	});

	it('浮点计算结果不会因精度误差判错', () => {
		const float: NumericQuestion = {
			kind: 'numeric',
			id: 'q-float',
			prompt: '0.1 + 0.2 = ?',
			answer: 0.1 + 0.2,
			explanation: '略'
		};
		expect(judgeNumeric(float, '0.3').correct).toBe(true);
	});
});

describe('judgeChoice', () => {
	const q: ChoiceQuestion = {
		kind: 'choice',
		id: 'q-choice',
		prompt: 'MQA 相比 MHA 的主要代价是什么？',
		options: ['显存变大', '质量下降', '延迟升高', '训练变慢'],
		answerIndex: 1,
		explanation: '所有头共享一组 KV，表达能力受限'
	};

	it('选对判对', () => {
		expect(judgeChoice(q, 1)).toMatchObject({ correct: true, verdict: 'exact' });
	});

	it('选错判错', () => {
		expect(judgeChoice(q, 0)).toMatchObject({ correct: false, verdict: 'wrong', parsed: 0 });
	});

	it('未选返回 empty', () => {
		expect(judgeChoice(q, null).verdict).toBe('empty');
	});

	it('下标越界返回 empty', () => {
		expect(judgeChoice(q, 9).verdict).toBe('empty');
		expect(judgeChoice(q, -1).verdict).toBe('empty');
	});
});

describe('judge 统一入口', () => {
	it('按 kind 分派到数值判定', () => {
		const q: NumericQuestion = {
			kind: 'numeric',
			id: 'n',
			prompt: 'x?',
			answer: 4,
			explanation: ''
		};
		expect(judge(q, '4').correct).toBe(true);
	});

	it('按 kind 分派到选择判定', () => {
		const q: ChoiceQuestion = {
			kind: 'choice',
			id: 'c',
			prompt: 'x?',
			options: ['a', 'b'],
			answerIndex: 0,
			explanation: ''
		};
		expect(judge(q, 0).correct).toBe(true);
	});

	it('选择题传入非数字视为未作答', () => {
		const q: ChoiceQuestion = {
			kind: 'choice',
			id: 'c2',
			prompt: 'x?',
			options: ['a', 'b'],
			answerIndex: 0,
			explanation: ''
		};
		expect(judge(q, 'a').verdict).toBe('empty');
	});
});
