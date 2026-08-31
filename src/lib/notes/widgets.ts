/**
 * 笔记内嵌可操纵部件的注册表。
 *
 * ## 这解决什么
 *
 * 笔记正文是「读」的，讲注意力时读者只能想象注意力矩阵长什么样。这里把讲解对象
 * 本身做成可操纵的部件，嵌在解释它的那段文字后面——读完「为什么要除以 sqrt(d_k)」
 * 立刻能把缩放开关关掉，看 softmax 怎么饱和成 one-hot。
 *
 * **这不是答题。** 题目走 `content/note-questions/`，分两档：已过审的判定对错并进
 * 间隔重复，未过审的作为思考卡只揭示不判定（见 `ThinkingCard.svelte`）。
 * 这里的部件两档都不是——没有通关判定，价值在把抽象的东西变成看得见、能动手改的。
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
import type { InteractionSpec } from '$lib/interactions/types';

export type NoteWidget = {
	/** 全站唯一稳定 id；用于 URL 锚点、发现入口和后续进度，禁止由数组下标生成 */
	id: string;
	/** 旧版自包含组件与新版声明式规格二选一，二者都必须按需加载 */
	load?: () => Promise<{ default: Component }>;
	loadSpec?: () => Promise<InteractionSpec>;
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
			id: 'attention-heatmap',
			load: () => import('$lib/components/AttentionHeatmap.svelte'),
			afterHeading: '2.2 为什么要除以 sqrt(d_k)：方差分析',
			invitation:
				'刚才的方差分析说「不缩放会让 softmax 饱和」。把下面的「除以 √d_k」关掉，就能看见那句话在矩阵上是什么样子。'
		}
	],

	'01-machine-learning/04-神经网络原理/02-反向传播推导': [
		{
			id: 'backprop-explorer',
			load: () => import('$lib/components/BackpropExplorer.svelte'),
			// 递推公式那节讲的就是 δ 逐层往前传，探索器把这个过程画出来
			afterHeading: '递推公式：δ 如何往前传',
			invitation:
				'上面的 δ 递推是公式形式。下面这张图是同一个网络的真实数值，拖动输入看每层的 δ 怎么变——把某个神经元推进死区，就能看到它下游的梯度整条归零。'
		}
	],

	'02-llm/05-推理优化/01-KV-Cache与显存分析': [
		{
			id: 'kv-cache-sandbox',
			load: () => import('$lib/components/KvCacheSandbox.svelte'),
			afterHeading: '3. 显存占用公式：逐项拆解',
			invitation:
				'公式拆完了，现在把它当成真实的部署决策：下面是 Llama 2 70B、batch 32、4K 上下文的场景，显存要压到 45 GB 以下且质量损失不超过 2%。12 种配置里只有 3 种同时满足——注意 MQA 最省显存，但它过不了质量那一条。'
		}
	],

	'02-llm/02-分词与表示/01-分词算法': [
		{
			id: 'tokenizer-cost-sandbox',
			load: () => import('$lib/components/TokenizerCostSandbox.svelte'),
			afterHeading: '1. 分词粒度的权衡',
			invitation:
				'粒度的权衡最后会变成账单。下面是一份 9000 字符的中文文档、每月 1000 份的场景：换分词器改变压缩率，切块改变请求数，两个约束（单次不超上下文安全额度、月成本低于预算）要同时成立。'
		}
	],

	'04-ai-agent/06-RAG进阶/01-RAG架构与核心流程': [
		{
			id: 'rag-chunking-sandbox',
			load: () => import('$lib/components/RagChunkingSandbox.svelte'),
			afterHeading: '3. 文档加载与分块',
			invitation:
				'分块参数的影响很难靠读记住。下面调块大小和重叠比例，看召回完整性与成本怎么互相拉扯。'
		}
	],

	'02-llm/04-微调与对齐/05-模型合并': [
		{
			id: 'model-merge-tradeoff',
			loadSpec: async () => (await import('$lib/interactions/specs')).MODEL_MERGE_SPEC,
			afterHeading: '5. 方法三：TIES-Merging（解决符号冲突）',
			invitation:
				'模型合并的关键不是“平均一下”，而是能力保留与参数冲突的权衡。调 α、任务向量强度与保留密度，看激进叠加何时开始反噬。'
		}
	],
	'02-llm/04-微调与对齐/06-合成数据生成': [
		{
			id: 'synthetic-data-collapse',
			loadSpec: async () => (await import('$lib/interactions/specs')).SYNTHETIC_DATA_SPEC,
			afterHeading: '7. 模型崩溃：合成数据最大的风险',
			invitation:
				'合成数据不是越多越好。调真实数据占比、筛选强度和循环轮数，看长尾多样性在哪一轮开始坍缩。'
		}
	],
	'04-ai-agent/04-Agent框架补充/01-Agent框架选型指南': [
		{
			id: 'agent-framework-decision',
			loadSpec: async () => (await import('$lib/interactions/specs')).FRAMEWORK_DECISION_SPEC,
			afterHeading: '3. 综合对比矩阵',
			invitation:
				'框架没有全局冠军，只有与你的工程约束更匹配的选择。改变权重，看推荐排名为什么会重排。'
		}
	],
	'04-ai-agent/12-模型服务/01-OpenAI与Claude API': [
		{
			id: 'api-cost-planner',
			loadSpec: async () => (await import('$lib/interactions/specs')).API_COST_SPEC,
			afterHeading: '5. 成本优化策略',
			invitation:
				'请求量、上下文长度、输出长度与缓存会一起变成账单。用你自己的价格和预算跑一遍，而不是背某家模型的历史报价。'
		}
	],
	'04-ai-agent/14-可观测与评估/06-Agent成本优化工程': [
		{
			id: 'prompt-cache-economics',
			loadSpec: async () => (await import('$lib/interactions/specs')).CACHE_ECONOMICS_SPEC,
			afterHeading: '2. Prompt Cache 经济学',
			invitation:
				'缓存命中率不是一个抽象指标。让工具顺序抖动一次，再切回稳定前缀，看同样的请求量为什么会出现数量级成本差。'
		}
	],
	'04-ai-agent/19-Voice Agent/01-语音Agent与实时交互': [
		{
			id: 'voice-latency-budget',
			loadSpec: async () => (await import('$lib/interactions/specs')).VOICE_LATENCY_SPEC,
			afterHeading: '11. 关键技术概念',
			invitation:
				'语音体验是串行延迟预算。调网络、ASR、LLM 首 token 和 TTS，找出哪一段真正拖慢了首响应。'
		}
	],
	'04-ai-agent/08-工具平台与沙箱/04-Web数据工具详解': [
		{
			id: 'web-tool-decision',
			loadSpec: async () => (await import('$lib/interactions/specs')).WEB_TOOL_SPEC,
			afterHeading: '9. 综合对比表',
			invitation:
				'抓网页、搜索事实和把 URL 变成正文是不同任务。调整新鲜度、动态页面、隐私和成本权重，看工具组合如何变化。'
		}
	],
	'04-ai-agent/17-Coding Agent/07-本地Coding Agent': [
		{
			id: 'local-coding-boundary',
			loadSpec: async () => (await import('$lib/interactions/specs')).LOCAL_CODING_SPEC,
			afterHeading: '5. 混合策略建议',
			invitation:
				'本地与云端不是二选一。调私有代码比例、任务复杂度、本地模型能力和预算，划出更合理的混合边界。'
		}
	],
	'04-ai-agent/14-可观测与评估/05-Agent测试工程实战': [
		{
			id: 'agent-test-budget',
			loadSpec: async () => (await import('$lib/interactions/specs')).TEST_BUDGET_SPEC,
			afterHeading: '11. 成本感知测试',
			invitation:
				'真实 LLM 测试比例越高，不等于可靠性越高。调 CI 用例数、真实调用比例和单次成本，看预算什么时候被穿透。'
		}
	],
	'04-ai-agent/15-Agent安全与治理/01-Agent身份与权限': [
		{
			id: 'delegation-blast-radius',
			loadSpec: async () => (await import('$lib/interactions/specs')).PERMISSION_RISK_SPEC,
			afterHeading: '6.3 Transaction Token：多跳链路中的爆炸半径控制',
			invitation:
				'权限风险取决于跳数、scope、TTL 与审批覆盖。把静态 API Key 场景切到事务 Token，直接看爆炸半径如何收缩。'
		}
	]
};

export function widgetId(widget: NoteWidget): string {
	return widget.id;
}

export function widgetsForNote(slug: string): readonly NoteWidget[] {
	return NOTE_WIDGETS[slug] ?? [];
}

export function interactionIdsForNote(slug: string): readonly string[] {
	return widgetsForNote(slug).map(widgetId);
}

export function interactionCountForNote(slug: string): number {
	return interactionIdsForNote(slug).length;
}

export function hasInteraction(slug: string): boolean {
	return interactionCountForNote(slug) > 0;
}

/**
 * 思考卡（未过审草稿题）在进度存储里的 id。
 *
 * 和实验共用同一个存储，但带 `thinking:` 前缀：两者来源完全不同——
 * 实验是本文件里手写的规格，思考卡是从 `content/note-questions/` 抽出来的草稿题。
 * 前缀保证一篇笔记的思考进度永远不会和某个实验的 id 撞车。
 *
 * 记的是「这篇我动过手了」，不是对错：思考卡不产出结论，也就没有可记的对错。
 */
export function thinkingInteractionId(slug: string): string {
	return `thinking:${slug}`;
}
