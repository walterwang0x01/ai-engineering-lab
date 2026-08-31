import type { InteractionEvaluation, InteractionSpec, InteractionTone } from './types';

function tone(value: number, ok: number, warn: number): InteractionTone {
	return value <= ok ? 'ok' : value <= warn ? 'warn' : 'bad';
}

function weightedScore(
	values: Readonly<Record<string, number>>,
	weightIds: readonly string[],
	scores: readonly number[]
): number {
	const weights = weightIds.map((id) => values[id] ?? 0);
	const total = weights.reduce((a, b) => a + b, 0) || 1;
	return scores.reduce((sum, score, i) => sum + score * (weights[i] ?? 0), 0) / total;
}

export const MODEL_MERGE_SPEC: InteractionSpec = {
	id: 'model-merge-tradeoff',
	type: 'formula',
	title: '模型合并不是把两个权重简单平均',
	description: '调节插值比例、任务向量强度和保留密度，观察能力保留与参数冲突如何此消彼长。',
	parameters: [
		{
			id: 'alpha',
			label: '模型 B 权重 α',
			min: 0,
			max: 1,
			step: 0.05,
			defaultValue: 0.5,
			digits: 2
		},
		{
			id: 'scale',
			label: '任务向量强度',
			min: 0,
			max: 1.5,
			step: 0.1,
			defaultValue: 0.8,
			digits: 1
		},
		{ id: 'density', label: '保留密度', min: 0.1, max: 1, step: 0.05, defaultValue: 0.7, digits: 2 }
	],
	presets: [
		{ id: 'safe', label: '保守合并', values: { alpha: 0.35, scale: 0.6, density: 0.8 } },
		{ id: 'aggressive', label: '激进叠加', values: { alpha: 0.7, scale: 1.3, density: 1 } },
		{ id: 'ties', label: 'TIES 风格', values: { alpha: 0.5, scale: 0.8, density: 0.45 } }
	],
	evaluate: (v) => {
		const conflict = Math.abs(v.alpha - 0.5) * 22 + v.scale * v.density * 34;
		const retentionA = Math.max(0, 100 - v.alpha * 62 - Math.max(0, v.scale - 1) * 18);
		const retentionB = Math.max(0, 38 + v.alpha * 62 - Math.max(0, v.scale - 1) * 12);
		const balance = Math.min(retentionA, retentionB) - conflict * 0.35;
		const t = tone(conflict, 22, 34);
		return {
			metrics: [
				{
					label: '能力 A 保留',
					value: retentionA,
					unit: '%',
					digits: 0,
					tone: retentionA >= 60 ? 'ok' : 'warn'
				},
				{
					label: '能力 B 保留',
					value: retentionB,
					unit: '%',
					digits: 0,
					tone: retentionB >= 60 ? 'ok' : 'warn'
				},
				{ label: '冲突指数', value: conflict, digits: 1, tone: t }
			],
			bars: [
				{
					label: '综合平衡',
					value: Math.max(0, balance),
					max: 100,
					tone: balance >= 55 ? 'ok' : 'warn',
					valueLabel: `${Math.round(Math.max(0, balance))}/100`
				}
			],
			conclusion:
				conflict > 34
					? '任务向量叠得太满：能力看似都加进来了，符号冲突却开始吞掉收益。降低强度或先裁剪低贡献参数。'
					: conflict < 22
						? '当前组合较稳，但过度稀疏也会丢能力。重点不是追求最小冲突，而是在两种能力都可用时控制冲突。'
						: '这是典型可用区：两边能力都有保留，冲突仍可控。真实上线还要用目标任务评测确认。',
			tone: t
		};
	}
};

export const SYNTHETIC_DATA_SPEC: InteractionSpec = {
	id: 'synthetic-data-collapse',
	type: 'simulation',
	title: '合成数据循环几轮后会开始自我复制？',
	description: '真实数据占比、筛选强度和自训练轮数共同决定多样性是否坍缩。',
	parameters: [
		{ id: 'real', label: '真实数据占比', min: 0, max: 100, step: 5, defaultValue: 30, unit: '%' },
		{ id: 'filter', label: '质量筛选强度', min: 0, max: 100, step: 5, defaultValue: 65, unit: '%' },
		{ id: 'rounds', label: '自训练轮数', min: 1, max: 12, step: 1, defaultValue: 4, unit: '轮' }
	],
	presets: [
		{ id: 'collapse', label: '纯合成循环', values: { real: 0, filter: 25, rounds: 10 } },
		{ id: 'guardrail', label: '真实数据保底', values: { real: 35, filter: 75, rounds: 6 } }
	],
	evaluate: (v) => {
		const decay = v.rounds * (1 - v.real / 100) * (1 - v.filter / 180) * 7.5;
		const diversity = Math.max(5, 100 - decay);
		const quality = Math.min(
			100,
			Math.max(10, 42 + v.real * 0.35 + v.filter * 0.38 - v.rounds * 1.2)
		);
		const risk = 100 - Math.min(diversity, quality);
		return {
			metrics: [
				{
					label: '数据多样性',
					value: diversity,
					unit: '%',
					digits: 0,
					tone: diversity >= 65 ? 'ok' : diversity >= 40 ? 'warn' : 'bad'
				},
				{
					label: '估算质量',
					value: quality,
					unit: '%',
					digits: 0,
					tone: quality >= 70 ? 'ok' : 'warn'
				},
				{ label: '崩溃风险', value: risk, unit: '%', digits: 0, tone: tone(risk, 25, 50) }
			],
			conclusion:
				diversity < 40
					? '模型正在反复学习自己的偏差：轮数越多，长尾模式越先消失。增加真实数据锚点比单纯加筛选更有效。'
					: '当前循环仍有真实数据与筛选兜底。注意：筛选只能减少坏样本，不能凭空补回已经消失的多样性。',
			tone: diversity < 40 ? 'bad' : diversity < 65 ? 'warn' : 'ok'
		};
	}
};

const FRAMEWORKS = [
	{ label: 'LangGraph', scores: [9, 7, 9, 9], reason: '复杂状态图与可控工作流强' },
	{ label: 'CrewAI', scores: [7, 6, 9, 7], reason: '角色式多 Agent 上手快' },
	{ label: 'PydanticAI', scores: [7, 10, 6, 7], reason: 'Python 类型安全与结构化输出强' },
	{ label: 'Vercel AI SDK', scores: [6, 8, 5, 10], reason: 'TypeScript 全栈与流式 UI 强' }
] as const;

export const FRAMEWORK_DECISION_SPEC: InteractionSpec = {
	id: 'agent-framework-decision',
	type: 'decision',
	title: '你的权重一变，最佳 Agent 框架就会变',
	description: '没有“全局最好”的框架。调节四个工程维度，看推荐结果如何重排。',
	parameters: [
		{ id: 'control', label: '流程可控性', min: 0, max: 10, step: 1, defaultValue: 8 },
		{ id: 'types', label: '类型安全', min: 0, max: 10, step: 1, defaultValue: 6 },
		{ id: 'multi', label: '多 Agent', min: 0, max: 10, step: 1, defaultValue: 7 },
		{ id: 'web', label: 'Web 全栈', min: 0, max: 10, step: 1, defaultValue: 4 }
	],
	presets: [
		{ id: 'workflow', label: '复杂工作流', values: { control: 10, types: 6, multi: 8, web: 2 } },
		{ id: 'ts', label: 'TS 产品团队', values: { control: 5, types: 8, multi: 3, web: 10 } },
		{ id: 'typed', label: '强类型 Python', values: { control: 6, types: 10, multi: 4, web: 2 } }
	],
	evaluate: (v) => {
		const ranking = FRAMEWORKS.map((f) => ({
			label: f.label,
			score: weightedScore(v, ['control', 'types', 'multi', 'web'], f.scores),
			reason: f.reason
		})).sort((a, b) => b.score - a.score);
		return {
			metrics: [
				{
					label: '领先优势',
					value: ranking[0].score - ranking[1].score,
					digits: 1,
					tone: ranking[0].score - ranking[1].score >= 1 ? 'ok' : 'warn'
				}
			],
			ranking,
			conclusion:
				ranking[0].score - ranking[1].score < 0.6
					? `没有明显赢家：${ranking[0].label} 与 ${ranking[1].label} 很接近。此时应做一周 spike，而不是继续争论表格。`
					: `${ranking[0].label} 在当前权重下领先。把最重要维度调低试试，你会看到“最佳框架”并不稳定。`,
			tone: 'neutral'
		};
	}
};

function tokenCost(v: Readonly<Record<string, number>>, cacheDiscount = 1): InteractionEvaluation {
	const requests = v.requests * 1000;
	const inputM = (requests * v.input) / 1_000_000;
	const outputM = (requests * v.output) / 1_000_000;
	const cachedInput = inputM * (v.cache / 100);
	const uncachedInput = inputM - cachedInput;
	const monthly =
		uncachedInput * v.inputPrice +
		cachedInput * v.inputPrice * cacheDiscount +
		outputM * v.outputPrice;
	const baseline = inputM * v.inputPrice + outputM * v.outputPrice;
	const saving = baseline - monthly;
	return {
		metrics: [
			{
				label: '月成本',
				value: monthly,
				unit: ' USD',
				digits: 0,
				tone: monthly <= v.budget ? 'ok' : 'bad'
			},
			{
				label: '缓存节省',
				value: saving,
				unit: ' USD',
				digits: 0,
				tone: saving > 0 ? 'ok' : 'neutral'
			},
			{ label: '每千请求', value: monthly / v.requests, unit: ' USD', digits: 2 }
		],
		bars: [
			{
				label: '预算占用',
				value: monthly,
				max: Math.max(v.budget, 1),
				tone: monthly <= v.budget ? 'ok' : 'bad',
				valueLabel: `$${Math.round(monthly)} / $${Math.round(v.budget)}`
			}
		],
		conclusion:
			monthly > v.budget
				? '当前请求结构会穿透月预算。优先提高可复用前缀的缓存命中率，再考虑换小模型；直接砍输出长度往往会损伤答案质量。'
				: `预算内运行。缓存命中每提升 10 个百分点，固定系统提示和工具定义都会更便宜。`,
		tone: monthly <= v.budget ? 'ok' : 'bad'
	};
}

export const API_COST_SPEC: InteractionSpec = {
	id: 'api-cost-planner',
	type: 'cost',
	title: '请求量、上下文和缓存如何变成月账单',
	description: '价格可按当前供应商手动调整；默认值只用于理解成本结构，不代表实时行情。',
	parameters: [
		{
			id: 'requests',
			label: '月请求量',
			min: 10,
			max: 2000,
			step: 10,
			defaultValue: 300,
			unit: 'k'
		},
		{
			id: 'input',
			label: '平均输入',
			min: 500,
			max: 20000,
			step: 500,
			defaultValue: 5000,
			unit: ' tok'
		},
		{
			id: 'output',
			label: '平均输出',
			min: 100,
			max: 5000,
			step: 100,
			defaultValue: 800,
			unit: ' tok'
		},
		{ id: 'cache', label: '缓存命中率', min: 0, max: 100, step: 5, defaultValue: 50, unit: '%' },
		{
			id: 'inputPrice',
			label: '输入价 / M',
			min: 0.1,
			max: 20,
			step: 0.1,
			defaultValue: 3,
			unit: '$',
			digits: 1
		},
		{
			id: 'outputPrice',
			label: '输出价 / M',
			min: 0.5,
			max: 60,
			step: 0.5,
			defaultValue: 15,
			unit: '$',
			digits: 1
		},
		{
			id: 'budget',
			label: '月预算',
			min: 100,
			max: 50000,
			step: 100,
			defaultValue: 5000,
			unit: '$'
		}
	],
	presets: [
		{ id: 'no-cache', label: '无缓存', values: { cache: 0 } },
		{ id: 'stable-prefix', label: '稳定前缀', values: { cache: 85 } }
	],
	evaluate: (v) => tokenCost(v, 0.1)
};

export const CACHE_ECONOMICS_SPEC: InteractionSpec = {
	...API_COST_SPEC,
	id: 'prompt-cache-economics',
	title: 'Cache Miss 为什么能把成本放大近 10 倍',
	description: '保持工具池和系统提示稳定，让更多输入按缓存价计费。',
	parameters: API_COST_SPEC.parameters.map((p) =>
		p.id === 'cache' ? { ...p, defaultValue: 80 } : p
	),
	presets: [
		{ id: 'miss', label: '工具顺序抖动', values: { cache: 10 } },
		{ id: 'hit', label: '稳定工具池', values: { cache: 90 } }
	]
};

export const VOICE_LATENCY_SPEC: InteractionSpec = {
	id: 'voice-latency-budget',
	type: 'constraint',
	title: '语音 Agent 的 800ms 延迟预算怎么分',
	description: '网络、ASR、LLM 首 token 与 TTS 是串联链路，任何一段变慢都会直接叠加。',
	parameters: [
		{ id: 'network', label: '网络往返', min: 20, max: 500, step: 10, defaultValue: 80, unit: 'ms' },
		{ id: 'asr', label: 'ASR 尾延迟', min: 50, max: 600, step: 10, defaultValue: 180, unit: 'ms' },
		{
			id: 'llm',
			label: 'LLM 首 token',
			min: 50,
			max: 1500,
			step: 25,
			defaultValue: 320,
			unit: 'ms'
		},
		{ id: 'tts', label: 'TTS 首音频', min: 50, max: 700, step: 10, defaultValue: 160, unit: 'ms' },
		{
			id: 'budget',
			label: '体验预算',
			min: 400,
			max: 2000,
			step: 50,
			defaultValue: 800,
			unit: 'ms'
		}
	],
	presets: [
		{ id: 'realtime', label: '端到端实时', values: { network: 50, asr: 100, llm: 180, tts: 100 } },
		{ id: 'slow-llm', label: '模型阻塞', values: { llm: 1000 } }
	],
	evaluate: (v) => {
		const total = v.network + v.asr + v.llm + v.tts;
		const t = total <= v.budget ? 'ok' : total <= v.budget * 1.3 ? 'warn' : 'bad';
		return {
			metrics: [
				{ label: '首响应延迟', value: total, unit: 'ms', digits: 0, tone: t },
				{ label: '剩余余量', value: v.budget - total, unit: 'ms', digits: 0, tone: t }
			],
			bars: [
				{
					label: '延迟预算',
					value: total,
					max: v.budget,
					tone: t,
					valueLabel: `${Math.round(total)} / ${Math.round(v.budget)}ms`
				}
			],
			conclusion:
				total > v.budget
					? `超预算 ${Math.round(total - v.budget)}ms。串行链路里最大的一段是首要优化目标；不要同时微调四处。`
					: '延迟在预算内。继续关注 P95，而不是只看平均值；打断与重连也要算进真实体验。',
			tone: t
		};
	}
};

const WEB_TOOLS = [
	{ label: 'Firecrawl', scores: [9, 6, 6, 7], reason: '动态网页与结构化抓取强' },
	{ label: 'Tavily', scores: [5, 9, 8, 8], reason: '面向 Agent 的新鲜搜索强' },
	{ label: 'Jina Reader', scores: [4, 5, 7, 10], reason: 'URL 转文本简单且低成本' },
	{ label: 'Brave Search', scores: [3, 8, 9, 8], reason: '独立搜索索引与隐私优势' }
] as const;
export const WEB_TOOL_SPEC: InteractionSpec = {
	id: 'web-tool-decision',
	type: 'decision',
	title: '抓网页、搜事实、读正文不是同一种工具',
	description: '调节动态页面、新鲜度、隐私与成本权重，看工具推荐如何变化。',
	parameters: [
		{ id: 'dynamic', label: '动态页面', min: 0, max: 10, step: 1, defaultValue: 8 },
		{ id: 'fresh', label: '搜索新鲜度', min: 0, max: 10, step: 1, defaultValue: 7 },
		{ id: 'privacy', label: '隐私要求', min: 0, max: 10, step: 1, defaultValue: 4 },
		{ id: 'cost', label: '成本敏感', min: 0, max: 10, step: 1, defaultValue: 6 }
	],
	presets: [
		{ id: 'rag', label: 'RAG 抓取', values: { dynamic: 9, fresh: 3, privacy: 4, cost: 5 } },
		{ id: 'research', label: '实时调研', values: { dynamic: 3, fresh: 10, privacy: 5, cost: 6 } },
		{ id: 'cheap', label: '低成本正文', values: { dynamic: 2, fresh: 3, privacy: 6, cost: 10 } }
	],
	evaluate: (v) => {
		const ranking = WEB_TOOLS.map((t) => ({
			label: t.label,
			score: weightedScore(v, ['dynamic', 'fresh', 'privacy', 'cost'], t.scores),
			reason: t.reason
		})).sort((a, b) => b.score - a.score);
		return {
			metrics: [
				{
					label: '领先优势',
					value: ranking[0].score - ranking[1].score,
					digits: 1,
					tone: ranking[0].score - ranking[1].score > 1 ? 'ok' : 'warn'
				}
			],
			ranking,
			conclusion: `当前首选 ${ranking[0].label}。如果你同时需要“搜索”和“抓取”，最佳实践通常是组合两种工具，而不是强迫一个工具包办。`,
			tone: 'neutral'
		};
	}
};

export const LOCAL_CODING_SPEC: InteractionSpec = {
	id: 'local-coding-boundary',
	type: 'decision',
	title: '哪些任务该留在本地模型，哪些该交给云端 Agent',
	description: '隐私、复杂度、本地吞吐和预算共同决定混合边界。',
	parameters: [
		{
			id: 'privacy',
			label: '私有代码比例',
			min: 0,
			max: 100,
			step: 5,
			defaultValue: 70,
			unit: '%'
		},
		{ id: 'complexity', label: '任务复杂度', min: 0, max: 10, step: 1, defaultValue: 6 },
		{ id: 'local', label: '本地模型能力', min: 0, max: 10, step: 1, defaultValue: 7 },
		{ id: 'budget', label: '云端预算充裕度', min: 0, max: 10, step: 1, defaultValue: 4 }
	],
	presets: [
		{
			id: 'private',
			label: '敏感仓库',
			values: { privacy: 95, complexity: 5, local: 8, budget: 5 }
		},
		{ id: 'hard', label: '复杂重构', values: { privacy: 40, complexity: 10, local: 6, budget: 8 } }
	],
	evaluate: (v) => {
		const localShare = Math.max(
			0,
			Math.min(100, v.privacy * 0.55 + v.local * 5 - v.complexity * 5 - v.budget * 2)
		);
		return {
			metrics: [
				{
					label: '建议本地执行',
					value: localShare,
					unit: '%',
					digits: 0,
					tone: localShare >= 60 ? 'ok' : 'warn'
				},
				{ label: '建议云端协作', value: 100 - localShare, unit: '%', digits: 0 }
			],
			bars: [
				{
					label: '混合边界',
					value: localShare,
					max: 100,
					tone: 'neutral',
					valueLabel: `本地 ${Math.round(localShare)}%`
				}
			],
			conclusion:
				localShare > 70
					? '隐私与本地能力足以覆盖大多数任务。把跨仓库推理、长程规划和最终审查留给云端。'
					: localShare < 30
						? '复杂度和预算支持云端主导，但敏感上下文应先脱敏或通过本地检索摘要后再发送。'
						: '混合模式最合适：本地处理检索、补全和私有代码，云端承担高复杂度规划与验证。',
			tone: 'neutral'
		};
	}
};

export const TEST_BUDGET_SPEC: InteractionSpec = {
	id: 'agent-test-budget',
	type: 'cost',
	title: '真实 LLM 测试比例越高，不等于测试越可靠',
	description: '单元、Mock、真实模型和 Eval 应形成金字塔；这里看真实调用比例如何穿透预算。',
	parameters: [
		{ id: 'cases', label: '每次 CI 用例数', min: 50, max: 5000, step: 50, defaultValue: 1000 },
		{
			id: 'realRate',
			label: '真实 LLM 比例',
			min: 0,
			max: 100,
			step: 5,
			defaultValue: 10,
			unit: '%'
		},
		{
			id: 'cost',
			label: '每次真实调用',
			min: 0.001,
			max: 0.2,
			step: 0.001,
			defaultValue: 0.02,
			unit: '$',
			digits: 3
		},
		{ id: 'runs', label: '每月 CI 次数', min: 20, max: 1000, step: 20, defaultValue: 200 },
		{
			id: 'budget',
			label: '测试月预算',
			min: 50,
			max: 5000,
			step: 50,
			defaultValue: 500,
			unit: '$'
		}
	],
	presets: [
		{ id: 'pyramid', label: '测试金字塔', values: { realRate: 5 } },
		{ id: 'all-real', label: '全用真模型', values: { realRate: 100 } }
	],
	evaluate: (v) => {
		const calls = ((v.cases * v.realRate) / 100) * v.runs;
		const monthly = calls * v.cost;
		const t = monthly <= v.budget ? 'ok' : monthly <= v.budget * 1.5 ? 'warn' : 'bad';
		return {
			metrics: [
				{ label: '月真实调用', value: calls, digits: 0 },
				{ label: '月测试成本', value: monthly, unit: ' USD', digits: 0, tone: t },
				{ label: '确定性覆盖', value: 100 - v.realRate, unit: '%', digits: 0 }
			],
			bars: [
				{
					label: '预算占用',
					value: monthly,
					max: v.budget,
					tone: t,
					valueLabel: `$${Math.round(monthly)} / $${Math.round(v.budget)}`
				}
			],
			conclusion:
				monthly > v.budget
					? '真实模型调用穿透预算。把 schema、路由和解析器下沉到确定性测试，只保留少量黄金集做真实 Eval。'
					: '成本可控。真实 LLM 用例应覆盖高价值行为，而不是替代本来可以确定性断言的单元测试。',
			tone: t
		};
	}
};

export const PERMISSION_RISK_SPEC: InteractionSpec = {
	id: 'delegation-blast-radius',
	type: 'constraint',
	title: '多跳委托如何放大 Agent 权限爆炸半径',
	description: '链路跳数、权限范围、Token TTL 与人工审批共同决定一次凭证泄漏能影响多大范围。',
	parameters: [
		{ id: 'hops', label: '委托跳数', min: 1, max: 8, step: 1, defaultValue: 3 },
		{ id: 'scope', label: '权限范围', min: 1, max: 10, step: 1, defaultValue: 6 },
		{ id: 'ttl', label: 'Token TTL', min: 1, max: 120, step: 1, defaultValue: 30, unit: 'min' },
		{
			id: 'approval',
			label: '人工审批覆盖',
			min: 0,
			max: 100,
			step: 5,
			defaultValue: 25,
			unit: '%'
		}
	],
	presets: [
		{ id: 'static', label: '静态 API Key', values: { hops: 6, scope: 10, ttl: 120, approval: 0 } },
		{ id: 'transaction', label: '事务 Token', values: { hops: 3, scope: 3, ttl: 5, approval: 70 } }
	],
	evaluate: (v) => {
		const risk = Math.max(
			0,
			Math.min(100, v.hops * v.scope * 1.6 + v.ttl * 0.35 - v.approval * 0.45)
		);
		const t = tone(risk, 30, 60);
		return {
			metrics: [
				{ label: '爆炸半径指数', value: risk, digits: 0, tone: t },
				{
					label: '有效暴露窗口',
					value: v.ttl * (1 - v.approval / 150),
					unit: 'min',
					digits: 0,
					tone: t
				}
			],
			bars: [
				{ label: '权限风险', value: risk, max: 100, tone: t, valueLabel: `${Math.round(risk)}/100` }
			],
			conclusion:
				risk > 60
					? '这是高风险委托链：凭证过宽、过久且跨多跳。改用 invocation-bound / transaction token，并把高危操作放到人工审批后。'
					: risk < 30
						? '最小权限、短 TTL 与审批共同压住了爆炸半径。继续确保 Token 不进入 LLM 上下文。'
						: '风险中等：优先缩小 scope 与 TTL，它们比单纯增加日志更能减少实际损失。',
			tone: t
		};
	}
};
