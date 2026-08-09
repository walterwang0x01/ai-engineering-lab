/**
 * 判定引擎。
 *
 * 这是整个学习闭环的核心：没有可靠判定，就只能自评，
 * 而自评没有即时反馈、且人会高估自己。
 *
 * 判定必须宽容于「表达形式」，严格于「数值正确性」：
 * 用户输入 "20 GB"、"20"、"２０"、"1,024" 都应被正确解析，
 * 但 20 和 21 必须区分开（除非题目显式给了容差）。
 */

import type { ChoiceQuestion, JudgeResult, NumericQuestion, Question } from './types';

/** 浮点比较的兜底精度，避免 0.1+0.2 !== 0.3 这类问题 */
const FLOAT_EPSILON = 1e-9;

/** 全角数字与符号 → 半角 */
function toHalfWidth(input: string): string {
	return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 把用户输入解析为数字。
 *
 * 容忍：前后空白、全角数字、千分位逗号、单位后缀（GB/倍/%/个…）、
 * 前导的「约」「=」「≈」、科学计数法。
 *
 * @returns 解析出的数字，无法解析时返回 null
 */
export function parseNumeric(raw: string): number | null {
	if (typeof raw !== 'string') return null;

	let s = toHalfWidth(raw).trim();
	if (s === '') return null;

	// 去掉前导的近似符号和等号
	s = s.replace(/^[约≈=~\s]+/, '');
	// 去掉千分位逗号（仅当逗号出现在数字之间）
	s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');

	// 抓取第一个合法数字（含正负号、小数、科学计数法）
	// 单位后缀（GB、倍、%、tokens…）会被自然忽略
	const match = s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
	if (!match) return null;

	const value = Number(match[0]);
	return Number.isFinite(value) ? value : null;
}

/** 判定数值题 */
export function judgeNumeric(question: NumericQuestion, raw: string): JudgeResult {
	const parsed = parseNumeric(raw);

	if (parsed === null) {
		// 区分「什么都没填」和「填了但不是数字」，界面给不同提示
		const isEmpty = toHalfWidth(raw ?? '').trim() === '';
		return { correct: false, verdict: isEmpty ? 'empty' : 'unparseable' };
	}

	const { answer, tolerance = 0, relativeTolerance = 0 } = question;
	const absError = Math.abs(parsed - answer);

	// 相对误差：answer 为 0 时无意义，退化为只看绝对误差
	const relativeError = answer === 0 ? undefined : absError / Math.abs(answer);

	// 精确命中（含浮点兜底）
	if (absError <= FLOAT_EPSILON) {
		return { correct: true, verdict: 'exact', parsed, relativeError };
	}

	// 容差命中：绝对容差与相对容差满足任一即可
	const withinAbsolute = tolerance > 0 && absError <= tolerance + FLOAT_EPSILON;
	const withinRelative =
		relativeTolerance > 0 &&
		relativeError !== undefined &&
		relativeError <= relativeTolerance + FLOAT_EPSILON;

	if (withinAbsolute || withinRelative) {
		return { correct: true, verdict: 'within-tolerance', parsed, relativeError };
	}

	return { correct: false, verdict: 'wrong', parsed, relativeError };
}

/** 判定单选题 */
export function judgeChoice(question: ChoiceQuestion, selected: number | null): JudgeResult {
	if (selected === null || selected < 0 || selected >= question.options.length) {
		return { correct: false, verdict: 'empty' };
	}
	return selected === question.answerIndex
		? { correct: true, verdict: 'exact', parsed: selected }
		: { correct: false, verdict: 'wrong', parsed: selected };
}

/**
 * 统一判定入口。
 * @param answer 数值题传字符串，选择题传选项下标
 */
export function judge(question: Question, answer: string | number | null): JudgeResult {
	if (question.kind === 'numeric') {
		return judgeNumeric(question, typeof answer === 'string' ? answer : String(answer ?? ''));
	}
	return judgeChoice(question, typeof answer === 'number' ? answer : null);
}
