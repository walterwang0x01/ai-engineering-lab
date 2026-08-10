/**
 * 关卡注册表 —— 全站唯一的关卡数据源。
 *
 * 路由 `/[levelId]`、首页卡片列表、预渲染路径清单都从这里生成。
 * 新增关卡只改这个文件，不会再出现「关卡能直连访问但首页进不去」的孤儿页面
 * （那是独立审计在阶段 0 抓到的真实缺陷）。
 *
 * 顺序即学习路径顺序，首页按此顺序展示。
 */

import { KV_CACHE_QUESTIONS } from '$lib/quiz/kv-cache-questions';
import { KV_CACHE_CODE_QUESTIONS } from '$lib/quiz/kv-cache-code-questions';
import { ATTENTION_QUESTIONS } from '$lib/quiz/attention-questions';
import { BACKPROP_QUESTIONS } from '$lib/quiz/backprop-questions';
import { TOKENIZER_QUESTIONS } from '$lib/quiz/tokenizer-questions';
import { RAG_CHUNKING_QUESTIONS } from '$lib/quiz/rag-chunking-questions';
import type { LevelDefinition } from './types';

export const LEVELS: LevelDefinition[] = [
	{
		id: 'backprop',
		eyebrow: '神经网络原理 · 第 1 关',
		title: '反向传播与死亡 ReLU',
		lede:
			'这一关结束后，你应该能在纸上手推一个小网络的梯度，' +
			'并解释为什么一个神经元会「死掉」——以及死掉之后为什么再也活不过来。',
		card: {
			tag: '神经网络原理',
			summary:
				'手推链式法则，然后亲眼看着 ReLU 的导数归零、整条梯度链断掉。' +
				'含可拖动的梯度浏览器和 2 道浏览器内运行的 Python 题。',
			points: ['链式法则的逐层展开与手算验证', 'ReLU 死亡的完整因果链', '手写 ReLU 前向与反向传播']
		},
		seo: {
			title: '反向传播与死亡 ReLU · AI Engineering Lab',
			description:
				'手推小网络的梯度，看 ReLU 导数归零如何让整条梯度链断掉。' +
				'含可交互梯度浏览器与浏览器内运行的 Python 代码题。',
			ogImage: 'backprop.png'
		},
		questions: BACKPROP_QUESTIONS,
		interactive: {
			heading: '先动手：让一个神经元死掉',
			note:
				'这一关的交互没有「通关」——它要展示的是一条因果链，不是一组取舍。' +
				'把输入调到负数，盯着 ReLU 导数那一栏。',
			load: () => import('$lib/components/BackpropExplorer.svelte')
		}
	},
	{
		id: 'tokenizer',
		eyebrow: '分词与表示 · 第 2 关',
		title: 'Tokenizer 与成本',
		lede:
			'这一关结束后，你应该能估出一段文本的 token 数和 API 成本，' +
			'并解释为什么同样的信息量，中文和代码的 token 效率差这么多。',
		card: {
			tag: '分词与表示',
			summary:
				'估算 token 数与调用成本，理解词表大小和序列长度的真实取舍。' +
				'含双约束沙盒——9 个配置里只有 1 个能同时满足成本和上下文预算。',
			points: [
				'BPE 合并步骤与词表大小的影响',
				'中文与代码的 token 效率差异',
				'成本、上下文窗口、缓存命中的联动'
			]
		},
		seo: {
			title: 'Tokenizer 与成本 · AI Engineering Lab',
			description:
				'估算 token 数与 API 成本，理解词表大小与序列长度的取舍。' +
				'含双约束沙盒与浏览器内运行的 BPE 实现题。',
			ogImage: 'tokenizer.png'
		},
		questions: TOKENIZER_QUESTIONS,
		interactive: {
			heading: '先动手：在成本与上下文之间找可行区间',
			note:
				'两个预算必须同时满足。9 个配置组合里只有 1 个可行——' +
				'「选最省 token 的方案」恰好会失败，先猜猜为什么。',
			load: () => import('$lib/components/TokenizerCostSandbox.svelte')
		}
	},
	{
		id: 'attention',
		eyebrow: 'Transformer 原理 · 第 3 关',
		title: 'Attention 与因果掩码',
		lede:
			'这一关结束后，你应该能说清三件事：注意力显存为什么随序列长度平方增长、' +
			'缩放因子 1/√d_k 是怎么推出来的、Flash Attention 省掉的究竟是什么。',
		card: {
			tag: 'Transformer 原理',
			summary:
				'说清注意力显存为什么平方增长、缩放因子 1/√d_k 怎么推出来、' +
				'Flash Attention 省掉的是什么。含可交互热力图和 2 道浏览器内运行的 Python 题。',
			points: [
				'分数矩阵的平方复杂度与长上下文瓶颈',
				'缩放因子的实证来历与 softmax 饱和',
				'手写数值稳定 softmax 与因果掩码'
			]
		},
		seo: {
			title: 'Attention 与因果掩码 · AI Engineering Lab',
			description:
				'注意力矩阵为什么是平方增长、缩放因子 1/√d_k 从哪来、Flash Attention 到底省了什么。' +
				'含可交互热力图与浏览器内运行的 Python 代码题。',
			ogImage: 'attention.png'
		},
		questions: ATTENTION_QUESTIONS,
		interactive: {
			heading: '先动手：看见注意力矩阵',
			note:
				'这一关的交互没有「通关」——注意力机制不存在 KV Cache 那种显存与质量的取舍。' +
				'它的价值在于让你亲眼看到掩码屏蔽了什么、缩放防止了什么。',
			load: () => import('$lib/components/AttentionHeatmap.svelte')
		}
	},
	{
		id: 'kv-cache',
		eyebrow: '推理优化 · 第 4 关',
		title: 'KV Cache 容量规划',
		lede:
			'这一关结束后，你应该能在白板上直接算出「这个模型这个并发要几张卡」，' +
			'并说清 GQA 的组数该怎么定。',
		card: {
			tag: '推理优化',
			summary:
				'算出「这个模型这个并发要几张卡」。含一个双约束沙盒关卡——' +
				'显存和质量同时要满足，光选最省的通不过。',
			points: [
				'KV Cache 显存公式与心算基准',
				'MHA / GQA / MQA 的真实权衡',
				'量化收益与容量规划完整链路'
			]
		},
		seo: {
			title: 'KV Cache 容量规划 · AI Engineering Lab',
			description:
				'通过可判定的计算题和双约束参数沙盒，掌握 KV Cache 显存计算、GQA/MQA 权衡与推理服务容量规划。' +
				'12 个配置组合里只有 3 个能同时满足显存和质量预算。',
			ogImage: 'kv-cache.png'
		},
		// 代码题排在数值题之后：先建立量级直觉，再动手实现
		questions: [...KV_CACHE_QUESTIONS, ...KV_CACHE_CODE_QUESTIONS],
		interactive: {
			heading: '先动手：找出可行配置',
			note: '先玩再学。不用先读理论——直接调参数，看约束怎么被打破，再回来做题。',
			load: () => import('$lib/components/KvCacheSandbox.svelte')
		}
	},
	{
		id: 'rag-chunking',
		eyebrow: 'RAG 工程 · 第 5 关',
		title: 'RAG 分块与检索质量',
		lede:
			'这一关结束后，你应该能在召回率、噪声、成本这三者之间找到可行区间，' +
			'并解释为什么「分块越小越精确」是个错觉。',
		card: {
			tag: 'RAG 工程',
			summary:
				'在召回率、噪声、成本的三角约束里找可行解。12 个配置组合只有 3 个可行，' +
				'而「分块越小越好」这个直觉对应的配置全部失败。',
			points: [
				'分块数量、重叠开销与存储成本的精确计算',
				'召回率与噪声为什么互相拉扯',
				'手写带重叠的分块函数'
			]
		},
		seo: {
			title: 'RAG 分块与检索质量 · AI Engineering Lab',
			description:
				'在召回率、噪声、成本三者之间找可行区间。12 个配置组合里只有 3 个同时满足三个预算，' +
				'而「分块越小越精确」的直觉全部失败。含浏览器内运行的分块实现题。',
			ogImage: 'rag-chunking.png'
		},
		questions: RAG_CHUNKING_QUESTIONS,
		interactive: {
			heading: '先动手：在三角约束里找可行区间',
			note:
				'三个预算必须同时满足。12 个组合只有 3 个可行——' +
				'先猜「分块越小越精确」能不能过，再动手验证。',
			load: () => import('$lib/components/RagChunkingSandbox.svelte')
		}
	}
];

/** 按 id 查关卡 */
export function getLevel(id: string): LevelDefinition | undefined {
	return LEVELS.find((l) => l.id === id);
}

/** 预渲染需要的全部路径 */
export const LEVEL_IDS = LEVELS.map((l) => l.id);
