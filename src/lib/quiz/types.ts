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

/**
 * 一条测试用例。
 *
 * 拆成多条而不是一整段 assert，是为了给出渐进反馈——
 * 「3/5 通过，形状对了但 softmax 没归一化」比「失败」有用得多。
 */
export interface CodeTestCase {
	/** 展示给用户的描述，说明这条在检查什么 */
	label: string;
	/** 断言代码。可以访问用户代码定义的名字，以及 setup 里导入的模块 */
	code: string;
}

/**
 * 代码题：在浏览器内跑 Python，用断言判定。
 *
 * 判定是**异步**的（要启动 Worker 和 Pyodide），
 * 所以不走同步的 judge()，而是 judgeCode()。
 */
export interface CodeQuestion {
	kind: 'code';
	id: string;
	prompt: string;
	/** 预填在编辑器里的起始代码，通常含 TODO 注释 */
	starterCode: string;
	/**
	 * 在用户代码**之前**执行的准备代码，如 import 和测试数据。
	 * 用户看不到也改不了，保证测试环境一致。
	 */
	setupCode?: string;
	/** 需要加载的 Pyodide 包，如 ['numpy']。留空则只用标准库，加载快得多 */
	packages?: string[];
	/** 测试用例，全部通过才算答对 */
	tests: CodeTestCase[];
	explanation: string;
	hint?: string;
	/** 参考答案。用户放弃时可查看，也用于测试验证题目本身自洽 */
	solutionCode: string;
}

export type Question = NumericQuestion | ChoiceQuestion | CodeQuestion;

/**
 * 能同步判定的题型。
 *
 * 这个别名不是为了少打字，而是让类型系统强制分派：
 * QuizCard 只接受 SyncQuestion，把代码题传给它会在编译期报错，
 * 而不是等到运行时 judge() 抛异常。
 */
export type SyncQuestion = NumericQuestion | ChoiceQuestion;

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

/** 单条测试用例的执行结果 */
export interface CodeTestResult {
	label: string;
	passed: boolean;
	/** 失败原因，通常是断言消息或异常类型 */
	message?: string;
}

/** 代码题的判定结果 */
export interface CodeRunResult {
	/** 全部用例通过才为 true */
	correct: boolean;
	outcome:
		| /** 全部用例通过 */ 'pass'
		| /** 有用例未通过 */ 'fail'
		| /** 用户代码本身报错，测试没跑起来 */ 'error'
		| /** 超时被熔断 */ 'timeout'
		| /** Pyodide 加载失败，通常是网络问题 */ 'unavailable';
	/** 逐条用例结果。outcome 为 error/timeout/unavailable 时可能为空 */
	tests: CodeTestResult[];
	/** 用户代码的 print 输出 */
	stdout: string;
	/** 报错信息。error 时是 Python traceback 的关键行 */
	error?: string;
	/** 执行耗时毫秒，不含 Pyodide 加载时间 */
	durationMs?: number;
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
