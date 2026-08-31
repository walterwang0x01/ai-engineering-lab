/**
 * 笔记 manifest / quiz 的类型契约，对应 scripts/sync-notes.mjs 的输出结构。
 *
 * 这两个 JSON 由构建期脚本生成到 static/notes/，运行时通过 fetch 读取——
 * 不是从 TS 模块导入，所以类型只能手写对齐，不能靠脚本导出常量强制同步。
 * 改了 sync-notes.mjs 的输出结构，务必同步改这里。
 */

import type { ChoiceQuestion } from '$lib/quiz/types';

/** 单篇笔记的元数据（学习路径页渲染用） */
export interface NoteEntry {
	/** 笔记的唯一标识，同时是 static/notes/ 下的相对路径（不含 .md 后缀） */
	slug: string;
	title: string;
	wordCount: number;
	/** 预估阅读分钟数 */
	minutes: number;
	hasCode: boolean;
	hasMath: boolean;
	hasMermaid: boolean;
	hasQuiz: boolean;
	/** 已过审、可判定对错的题数（Tier A） */
	gradable: number;
	/** 未过审、只作思考卡展示的题数 */
	thinking: number;
}

export interface NoteSection {
	/**
	 * 原始目录名，含数字前缀（如 `01-Transformer原理`）。空串表示模块根目录。
	 *
	 * 这是**排序键**：前缀就是笔记作者定的学习顺序。展示用 `section`。
	 * 两者曾经合并成一个字段，排序因此按剥掉前缀的名字进行，
	 * 学习路径的顺序被打乱到几乎失去意义。
	 */
	dir: string;
	/** 展示用章节名，已去掉数字前缀。模块根目录下的笔记为空字符串 */
	section: string;
	notes: NoteEntry[];
}

export interface NoteModule {
	id: string;
	label: string;
	notes: number;
	sections: NoteSection[];
}

export interface NotesManifest {
	generatedAt: string;
	count: number;
	modules: NoteModule[];
}

/** slug → 该篇的自测题列表（开放题，纯展示） */
export type QuizItems = Record<string, string[]>;

export interface NotesQuiz {
	generatedAt: string;
	total: number;
	items: QuizItems;
}

/**
 * slug → 该篇的**可判定**题（Tier A）。
 *
 * 与上面的 NotesQuiz 是两回事：那个是开放题、只能自评；
 * 这个由 judge() 判定对错，走和关卡题完全相同的判定与间隔重复路径。
 *
 * 只含选择题：数值题必须留在关卡题库里，因为 AGENTS.md 要求每道数值题
 * 都有测试用独立公式重算答案，抽取管道无法代替那一步。
 */
export interface NotesGradable {
	generatedAt: string;
	/** 已过审并进入产物的题目总数 */
	total: number;
	/** 未过审题的数量。它们没被丢掉，而是进了 thinking.json */
	drafts: number;
	/** 有可判定题的篇数 */
	notes: number;
	items: Record<string, ChoiceQuestion[]>;
}

/**
 * slug → 该篇的**思考卡**题。
 *
 * 这些题结构与可判定题完全一致，唯一区别是 `reviewed` 不为 true——
 * 人还没逐题核实过。所以它们：
 *
 *   - **不判定对错**，界面上不给「答对 / 答错」的结论；
 *   - **不写学习记录**，不进掌握度、不进间隔重复排期；
 *   - **在界面上标明未过审**，读者知道自己在看草稿。
 *
 * 让草稿上线的理由：仓库里 90% 以上的题都停在未过审状态，
 * 一律藏起来的结果是绝大多数笔记一个可动手的东西都没有。
 * 门禁要防的是「把没核实的内容当成核实过的发出去」，
 * 而思考卡不产出任何结论，只是把已经写好的解析摆出来让人边读边想。
 */
export interface NotesThinking {
	generatedAt: string;
	total: number;
	notes: number;
	items: Record<string, ChoiceQuestion[]>;
}
