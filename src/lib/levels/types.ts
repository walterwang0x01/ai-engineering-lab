/**
 * 关卡定义。
 *
 * 抽象边界是从两个真实样本推出来的，不是先设计后套用：
 * KV Cache 是「达标型沙盒」（双约束调参），Attention 是「观察型热力图」（无判定）。
 *
 * 对比这两个之后的结论：
 *
 * - **页面骨架 100% 相同** —— 进度载入、复习队列、按题型分派、掌握度统计、
 *   换题的 {#key}、重新开始一轮。约 300 行，一字不差重复了两遍。**这部分必须抽象。**
 *
 * - **交互组件差异极大** —— 一个有约束和达标判定，一个只有观察和指标。
 *   把它们的内部逻辑压成声明式配置，会得到一个既复杂又不够用的 DSL：
 *   下一个关卡总会有它表达不了的东西。**所以交互组件作为组件传入，不抽象。**
 *
 * 结果是新增关卡只需要三件事：写题库、写交互组件（可选）、在 registry 加一项。
 * 页面和路由由 src/routes/[levelId] 统一处理，首页卡片从 registry 自动生成。
 */

import type { Component } from 'svelte';
import type { Question } from '$lib/quiz/types';

/** 交互区。没有天然双约束的主题可以完全省略这一块 */
export interface LevelInteractive {
	/** 交互区标题，如「先动手：找出可行配置」 */
	heading: string;
	/** 交互区说明。观察型交互应在这里说明「没有通关」 */
	note: string;
	/**
	 * 异步加载交互组件。
	 *
	 * 必须是动态 import：静态导入会让所有关卡的交互组件都进首屏 bundle，
	 * 用户打开一个关卡却下载了全部关卡的可视化代码。
	 */
	load: () => Promise<{ default: Component<Record<string, never>> }>;
}

export interface LevelDefinition {
	/** 路由片段与 id 前缀。所有题目 id 必须以 `${id}-` 开头 */
	id: string;
	/** 模块归属，如「推理优化 · 第 1 关」 */
	eyebrow: string;
	title: string;
	/** 页头导语：这一关结束后你能做什么 */
	lede: string;

	/** 首页卡片内容 */
	card: {
		/** 模块标签 */
		tag: string;
		/** 一段话说清这关的能力目标 */
		summary: string;
		/** 三条要点 */
		points: string[];
	};

	seo: {
		title: string;
		description: string;
		/** static/og/ 下的文件名 */
		ogImage: string;
	};

	/** 题库。可混合 numeric / choice / code */
	questions: Question[];

	interactive?: LevelInteractive;
}
