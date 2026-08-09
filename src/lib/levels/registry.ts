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
import type { LevelDefinition } from './types';

export const LEVELS: LevelDefinition[] = [
	{
		id: 'attention',
		eyebrow: 'Transformer 原理 · 第 1 关',
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
		eyebrow: '推理优化 · 第 2 关',
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
	}
];

/** 按 id 查关卡 */
export function getLevel(id: string): LevelDefinition | undefined {
	return LEVELS.find((l) => l.id === id);
}

/** 预渲染需要的全部路径 */
export const LEVEL_IDS = LEVELS.map((l) => l.id);
