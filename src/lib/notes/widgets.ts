/**
 * 笔记内嵌可操纵部件的注册表。
 *
 * ## 这解决什么
 *
 * 笔记正文是「读」的，讲注意力时读者只能想象注意力矩阵长什么样。这里把讲解对象
 * 本身做成可操纵的部件，嵌在解释它的那段文字后面——读完「为什么要除以 sqrt(d_k)」
 * 立刻能把缩放开关关掉，看 softmax 怎么饱和成 one-hot。
 *
 * **这不是答题。** 题目走 `content/note-questions/`，判定对错；这里的部件没有通关判定，
 * 价值在把抽象的东西变成看得见、能动手改的。
 *
 * ## 为什么放在本仓库而不是笔记源里
 *
 * 笔记 markdown 在另一个仓库（稀疏检出），在源文件里加标记要跨仓库改 168 篇。
 * 按 slug 建注册表是本仓库已有的先例（`content/note-questions/<slug>.json`），
 * 笔记源一个字都不用动。
 *
 * ## 锚点为什么用标题文本而不是序号
 *
 * 用「第 N 个 h3」在作者插入一节后会静默错位——部件跑到不相关的段落底下，
 * 而这种错位没人会发现。标题文本改了则是**显式失效**：找不到锚点就不渲染，
 * 且开发期会在控制台报出来，作者能知道要更新映射。
 */
import type { Component } from 'svelte';

export type NoteWidget = {
	/** 懒加载部件。必须懒加载：这些沙盒不该出现在只读笔记的首包里 */
	load: () => Promise<{ default: Component }>;
	/**
	 * 插在哪个标题所属的小节之后。
	 * 取标题的**完整文本**（不含 # 号），在渲染后的 DOM 里按 textContent 匹配。
	 */
	afterHeading: string;
	/** 一句话说明这个部件让读者能做什么，渲染在部件上方 */
	invitation: string;
};

/**
 * slug → 该篇要嵌入的部件。
 *
 * 目前复用 5 个关卡沙盒，嵌进它们各自的背景笔记（映射见 `curriculum/mapping.ts`）。
 * 这批组件都不接 props、完全自包含，所以能直接放到笔记页里。
 */
export const NOTE_WIDGETS: Readonly<Record<string, readonly NoteWidget[]>> = {
	'02-llm/01-Transformer原理/01-注意力机制推导': [
		{
			load: () => import('$lib/components/AttentionHeatmap.svelte'),
			afterHeading: '2.2 为什么要除以 sqrt(d_k)：方差分析',
			invitation:
				'刚才的方差分析说「不缩放会让 softmax 饱和」。把下面的「除以 √d_k」关掉，就能看见那句话在矩阵上是什么样子。'
		}
	],

	'01-machine-learning/04-神经网络原理/02-反向传播推导': [
		{
			load: () => import('$lib/components/BackpropExplorer.svelte'),
			// 递推公式那节讲的就是 δ 逐层往前传，探索器把这个过程画出来
			afterHeading: '递推公式：δ 如何往前传',
			invitation:
				'上面的 δ 递推是公式形式。下面这张图是同一个网络的真实数值，拖动输入看每层的 δ 怎么变——把某个神经元推进死区，就能看到它下游的梯度整条归零。'
		}
	],

	'02-llm/05-推理优化/01-KV-Cache与显存分析': [
		{
			load: () => import('$lib/components/KvCacheSandbox.svelte'),
			afterHeading: '3. 显存占用公式：逐项拆解',
			invitation:
				'公式拆完了，现在把它当成真实的部署决策：下面是 Llama 2 70B、batch 32、4K 上下文的场景，显存要压到 45 GB 以下且质量损失不超过 2%。12 种配置里只有 3 种同时满足——注意 MQA 最省显存，但它过不了质量那一条。'
		}
	],

	'02-llm/02-分词与表示/01-分词算法': [
		{
			load: () => import('$lib/components/TokenizerCostSandbox.svelte'),
			afterHeading: '1. 分词粒度的权衡',
			invitation:
				'粒度的权衡最后会变成账单。下面是一份 9000 字符的中文文档、每月 1000 份的场景：换分词器改变压缩率，切块改变请求数，两个约束（单次不超上下文安全额度、月成本低于预算）要同时成立。'
		}
	],

	'04-ai-agent/06-RAG进阶/01-RAG架构与核心流程': [
		{
			load: () => import('$lib/components/RagChunkingSandbox.svelte'),
			afterHeading: '3. 文档加载与分块',
			invitation:
				'分块参数的影响很难靠读记住。下面调块大小和重叠比例，看召回完整性与成本怎么互相拉扯。'
		}
	]
};

export function widgetsForNote(slug: string): readonly NoteWidget[] {
	return NOTE_WIDGETS[slug] ?? [];
}
