/**
 * 题库与判定的类型契约。
 *
 * 设计原则：每道题都必须能被程序确定性判定。
 * 不收录「谈谈你对 X 的理解」这类无法判定的开放题——
 * 没有判定就没有即时反馈，也就没有学习闭环。
 */

/** 数值计算题：答案是一个数，允许容差 */
export interface NumericQuestion {
	kind: 'numeric';
	id: string;
	/** 题干，可含换行 */
	prompt: string;
	/** 期望答案 */
	answer: number;
	/** 单位提示，仅用于展示（如 'GB'、'倍'） */
	unit?: string;
	/**
	 * 绝对容差。0 表示必须精确匹配。
	 * 与 relativeTolerance 是「或」关系，满足任一即判对。
	 */
	tolerance?: number;
	/** 相对容差，0.01 表示允许 1% 误差。用于显存这类连续量 */
	relativeTolerance?: number;
	/** 判定后展示的推导过程，这是学习价值的主体 */
	explanation: string;
	/** 可选提示，答错一次后才显示 */
	hint?: string;
}

/** 单选题：考概念辨析，错误选项要是真实的常见误解 */
export interface ChoiceQuestion {
	kind: 'choice';
	id: string;
	prompt: string;
	options: string[];
	/** 正确选项下标，0 起 */
	answerIndex: number;
	explanation: string;
	hint?: string;
	/**
	 * 针对每个错误选项的定向解释。
	 * 键是选项下标。答错时优先展示这条，比通用 explanation 更有针对性。
	 */
	distractorNotes?: Record<number, string>;
}

export type Question = NumericQuestion | ChoiceQuestion;

/** 判定失败的原因，用于给出不同的界面反馈 */
export type JudgeVerdict =
	/** 精确命中 */
	| 'exact'
	/** 在容差范围内 */
	| 'within-tolerance'
	/** 答案错误 */
	| 'wrong'
	/** 输入无法解析为数字 */
	| 'unparseable'
	/** 未作答 */
	| 'empty';

export interface JudgeResult {
	correct: boolean;
	verdict: JudgeVerdict;
	/** 解析后的规范化数值，便于界面回显「你答的是 20.5」 */
	parsed?: number;
	/** 与正确答案的相对偏差，用于「差一点」这类反馈 */
	relativeError?: number;
}

/** 一道题的学习记录，经 StorageBackend 持久化（当前实现是 localStorage） */
export interface AttemptRecord {
	questionId: string;
	/** 累计作答次数 */
	attempts: number;
	/** 累计答对次数 */
	correct: number;
	/** 最近一次作答时间戳 */
	lastAt: number;
	/** SM-2 熟练度等级，0 表示新题 */
	box: number;
	/** 下次复习时间戳 */
	dueAt: number;
}
