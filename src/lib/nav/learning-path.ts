/**
 * 推荐学习路线：从 168 篇笔记里挑出的 27 篇主线，排成一条带依赖的序列。
 *
 * 这个文件存在的理由：站点部署后，笔记库是 168 篇平铺的列表，
 * 其中 AI Agent 模块占 105 篇（63%），新手打开就是一面墙、不知道从哪篇开始。
 * 这条路线把「应该先读什么」固化成数据，让 notes 页能渲染一条有头有尾的路，
 * 而不是一个目录索引。
 *
 * 设计决策：
 * - 只列主线笔记（约 27 篇），不是全部 168 篇——其余的按需查阅，不该进路线。
 * - 分阶段（stage），每个阶段有目标说明，阶段内的笔记有先后顺序（order）。
 * - 前置依赖（prerequisites）用 slug 引用，让 UI 能显示「读完 X 再来」。
 * - 配套关卡（level）关联到 6 个交互式关卡，读完对应的笔记去做关卡。
 *
 * 这份路线与 curriculum/mapping.ts 的 LEVEL_BACKGROUND_NOTES 互补：
 * 那个是「关卡 → 背景笔记」的反查表，这个是「学习者 → 推荐序列」的正向引导。
 */

export interface PathStep {
	/** 笔记 slug，与 manifest 的 slug 完全一致 */
	slug: string;
	/** 在当前阶段内的排序，从 1 开始 */
	order: number;
	/** 前置笔记的 slug 列表（同一阶段或前阶段的）。空数组表示无前置 */
	prerequisites: string[];
	/** 配套关卡 id（如 'backprop'），没有则 undefined */
	level?: string;
	/** 标注：必读 / 选读 / 按需 */
	tier: 'required' | 'optional' | 'on-demand';
}

export interface PathStage {
	/** 阶段编号，从 0 开始 */
	id: number;
	/** 阶段名，如「地基：数学 + 神经网络」 */
	title: string;
	/** 阶段目标，一句话说明读完这组笔记应该能做什么 */
	goal: string;
	/** 该阶段的笔记序列 */
	steps: PathStep[];
}

/**
 * 推荐学习路线。
 *
 * 顺序即学习顺序。阶段之间的依赖是线性的：阶段 N 的笔记默认依赖
 * 阶段 N-1 的全部主线笔记，不需要在 prerequisites 里显式跨阶段引用。
 * prerequisites 只在阶段内部标注「这篇要先于那篇」。
 */
export const LEARNING_PATH: readonly PathStage[] = [
	{
		id: 0,
		title: '入门准备',
		goal: '建立「我要学的东西大概长什么样」的心智地图',
		steps: [
			{
				slug: '00-入门准备/01-AI技术全景与概念辨析',
				order: 1,
				prerequisites: [],
				tier: 'required'
			},
			{
				slug: '00-入门准备/02-开发环境与算力',
				order: 2,
				prerequisites: [],
				tier: 'required'
			},
			{
				slug: '00-入门准备/03-学习路线与常见误区',
				order: 3,
				prerequisites: [],
				tier: 'required'
			},
			{
				slug: '00-入门准备/04-如何读论文与跟进前沿',
				order: 4,
				prerequisites: [],
				tier: 'optional'
			}
		]
	},
	{
		id: 1,
		title: '地基：数学 + 神经网络',
		goal: '能手推一个小网络的梯度，理解反向传播',
		steps: [
			{
				slug: '01-machine-learning/00-数学基础/01-微积分够用篇',
				order: 1,
				prerequisites: [],
				tier: 'required'
			},
			{
				slug: '01-machine-learning/00-数学基础/02-线性代数够用篇',
				order: 2,
				prerequisites: ['01-machine-learning/00-数学基础/01-微积分够用篇'],
				tier: 'required'
			},
			{
				slug: '01-machine-learning/00-数学基础/03-概率统计够用篇',
				order: 3,
				prerequisites: ['01-machine-learning/00-数学基础/01-微积分够用篇'],
				tier: 'optional'
			},
			{
				slug: '01-machine-learning/04-神经网络原理/01-感知机与多层感知机',
				order: 4,
				prerequisites: ['01-machine-learning/00-数学基础/01-微积分够用篇'],
				tier: 'required'
			},
			{
				slug: '01-machine-learning/04-神经网络原理/05-损失函数',
				order: 5,
				prerequisites: ['01-machine-learning/04-神经网络原理/01-感知机与多层感知机'],
				tier: 'required'
			},
			{
				slug: '01-machine-learning/04-神经网络原理/03-梯度下降与优化器',
				order: 6,
				prerequisites: ['01-machine-learning/04-神经网络原理/05-损失函数'],
				tier: 'required'
			},
			{
				slug: '01-machine-learning/04-神经网络原理/04-激活函数',
				order: 7,
				prerequisites: ['01-machine-learning/04-神经网络原理/01-感知机与多层感知机'],
				tier: 'required'
			},
			{
				slug: '01-machine-learning/04-神经网络原理/02-反向传播推导',
				order: 8,
				prerequisites: [
					'01-machine-learning/04-神经网络原理/05-损失函数',
					'01-machine-learning/04-神经网络原理/03-梯度下降与优化器',
					'01-machine-learning/04-神经网络原理/04-激活函数'
				],
				level: 'backprop',
				tier: 'required'
			}
		]
	},
	{
		id: 2,
		title: 'Transformer 与分词',
		goal: '理解注意力机制、位置编码、分词与成本',
		steps: [
			{
				slug: '02-llm/01-Transformer原理/01-注意力机制推导',
				order: 1,
				prerequisites: [],
				level: 'attention',
				tier: 'required'
			},
			{
				slug: '02-llm/01-Transformer原理/02-位置编码',
				order: 2,
				prerequisites: ['02-llm/01-Transformer原理/01-注意力机制推导'],
				tier: 'required'
			},
			{
				slug: '02-llm/01-Transformer原理/03-架构组件与训练稳定性',
				order: 3,
				prerequisites: [
					'02-llm/01-Transformer原理/01-注意力机制推导',
					'02-llm/01-Transformer原理/02-位置编码'
				],
				tier: 'required'
			},
			{
				slug: '02-llm/02-分词与表示/01-分词算法',
				order: 4,
				prerequisites: [],
				level: 'tokenizer',
				tier: 'required'
			}
		]
	},
	{
		id: 3,
		title: '推理优化',
		goal: '理解 KV-Cache、量化、蒸馏——部署时最常遇到的取舍',
		steps: [
			{
				slug: '02-llm/05-推理优化/01-KV-Cache与显存分析',
				order: 1,
				prerequisites: [],
				level: 'kv-cache',
				tier: 'required'
			},
			{
				slug: '02-llm/05-推理优化/02-量化',
				order: 2,
				prerequisites: ['02-llm/05-推理优化/01-KV-Cache与显存分析'],
				level: 'deploy-decision',
				tier: 'required'
			},
			{
				slug: '02-llm/05-推理优化/03-蒸馏与剪枝',
				order: 3,
				prerequisites: ['02-llm/05-推理优化/01-KV-Cache与显存分析'],
				tier: 'optional'
			}
		]
	},
	{
		id: 4,
		title: 'AI Agent 入门',
		goal: '建立 Agent 基础认知，知道工具调用、RAG、多 Agent 是什么',
		steps: [
			{
				slug: '04-ai-agent/06-RAG进阶/01-RAG架构与核心流程',
				order: 1,
				prerequisites: [],
				level: 'rag-chunking',
				tier: 'required'
			},
			{
				slug: '04-ai-agent/00-基础概念/01-AI Agent概述与发展',
				order: 2,
				prerequisites: [],
				tier: 'required'
			},
			{
				slug: '04-ai-agent/00-基础概念/02-大语言模型基础',
				order: 3,
				prerequisites: ['04-ai-agent/00-基础概念/01-AI Agent概述与发展'],
				tier: 'required'
			},
			{
				slug: '04-ai-agent/00-基础概念/03-Prompt Engineering',
				order: 4,
				prerequisites: ['04-ai-agent/00-基础概念/02-大语言模型基础'],
				tier: 'required'
			},
			{
				slug: '04-ai-agent/03-Agent框架/01-LangGraph工作流编排',
				order: 5,
				prerequisites: ['04-ai-agent/00-基础概念/03-Prompt Engineering'],
				tier: 'optional'
			},
			{
				slug: '04-ai-agent/07-工具与Function Calling/01-Function Calling机制',
				order: 6,
				prerequisites: ['04-ai-agent/00-基础概念/03-Prompt Engineering'],
				tier: 'required'
			},
			{
				slug: '04-ai-agent/09-多Agent系统/01-多Agent架构模式',
				order: 7,
				prerequisites: [
					'04-ai-agent/03-Agent框架/01-LangGraph工作流编排',
					'04-ai-agent/07-工具与Function Calling/01-Function Calling机制'
				],
				tier: 'optional'
			},
			{
				slug: '04-ai-agent/14-可观测与评估/01-LLM可观测性',
				order: 8,
				prerequisites: ['04-ai-agent/07-工具与Function Calling/01-Function Calling机制'],
				tier: 'optional'
			}
		]
	}
];

/**
 * 路线上全部 step 的 slug 集合，用于判定「这篇在不在路线上」。
 * 在模块加载时构建一次。
 */
const PATH_SLUGS: ReadonlySet<string> = new Set(
	LEARNING_PATH.flatMap((stage) => stage.steps.map((s) => s.slug))
);

/** 该篇笔记是否在推荐学习路线上 */
export function isOnPath(slug: string): boolean {
	return PATH_SLUGS.has(slug);
}

/** 路线上的总篇数 */
export const PATH_COUNT: number = PATH_SLUGS.size;

/**
 * 一个 step 在学习者眼里的三种状态。
 *
 * 刻意比 `NoteProgress.state` 粗：那边分四档（mastered / in-progress / read /
 * untouched）是为了展示徽章，而「下一步该干什么」只需要知道**这一步收没收尾**。
 *
 * - `done`      —— 收尾了（读完 或 可判定题全掌握）
 * - `started`   —— 动过但没收尾，比如题做了一半
 * - `untouched` —— 完全没碰
 */
export type StepStatus = 'done' | 'started' | 'untouched';

export interface PathPosition {
	/** 下一步该读哪一篇。全部收尾时为 null */
	next: { stage: PathStage; step: PathStep } | null;
	/** 已收尾的步数 */
	doneCount: number;
	/** 路线总步数，等于 PATH_COUNT */
	total: number;
	/** 一步都还没碰过——决定文案是「开始」还是「继续」 */
	fresh: boolean;
	/** 下一步是否是「接着做没做完的那篇」，而不是「开一篇新的」 */
	resuming: boolean;
}

/**
 * 算出学习者在路线上的位置。
 *
 * 「下一步」= 按路线顺序（阶段、阶段内 order）第一个**没收尾**的 step。
 *
 * 两个关键决定：
 *
 * 1. **`started` 不算走过。** 一篇题做了一半的笔记，正是「上次到这里」该指回去的
 *    地方；把它当成走过、跳到下一篇，等于把人从断点上推走。
 * 2. **不重复校验 prerequisites。** 路线数据本身已是拓扑序（阶段线性依赖、
 *    阶段内靠 order），顺序扫描天然满足前置；再查一遍只会引入两套可能打架的规则。
 *
 * 传入 `statusOf` 而不是进度存储：这个文件保持纯函数、可单测，
 * 不依赖 Svelte runes 和 localStorage。
 */
export function pathPosition(statusOf: (slug: string) => StepStatus): PathPosition {
	let next: PathPosition['next'] = null;
	let doneCount = 0;
	let touchedAny = false;
	let nextStatus: StepStatus = 'untouched';

	for (const stage of LEARNING_PATH) {
		// 按 order 扫，不依赖数组书写顺序恰好等于 order
		for (const step of [...stage.steps].sort((a, b) => a.order - b.order)) {
			const status = statusOf(step.slug);
			if (status !== 'untouched') touchedAny = true;
			if (status === 'done') {
				doneCount += 1;
				continue;
			}
			if (next === null) {
				next = { stage, step };
				nextStatus = status;
			}
		}
	}

	return {
		next,
		doneCount,
		total: PATH_COUNT,
		fresh: !touchedAny,
		resuming: nextStatus === 'started'
	};
}
