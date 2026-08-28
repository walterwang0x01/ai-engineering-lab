/**
 * 综合挑战：部署决策
 *
 * 场景：你要把 Llama 2 70B 部署为推理服务。
 * 硬件是 8 × A100 80GB（总显存 640 GB）。
 * 目标：batch 32，上下文 4096 tokens，延迟要求每 token < 50ms。
 *
 * 每道题对应一个已学关卡的核心公式，但放进同一个真实部署场景里考——
 * 检验的不是「会背公式」，而是「能在决策中用对公式」。
 *
 * 模型参数（Llama 2 70B 真实配置）：
 *   layers = 80, heads = 64, head_dim = 128, GQA groups = 8
 *   vocab_size = 32000, hidden_dim = 8192
 *   fp16 权重 ≈ 130.4 GiB
 */

import type { Question } from './types';

/** 统一场景参数，测试文件也用这组数字独立重算 */
export const DEPLOY_SCENARIO = {
	model: 'Llama 2 70B',
	layers: 80,
	heads: 64,
	headDim: 128,
	gqaGroups: 8,
	vocabSize: 32000,
	hiddenDim: 8192,
	weightGiB: 130.4,
	batch: 32,
	seqLen: 4096,
	gpuCount: 8,
	gpuMemGiB: 80,
	totalMemGiB: 640
} as const;

export const DEPLOY_DECISION_QUESTIONS: Question[] = [
	// ── Q1: KV Cache 显存（来自 kv-cache 关卡公式）──
	{
		kind: 'numeric',
		id: 'deploy-decision-01-kv-cache-total',
		prompt:
			'Llama 2 70B，GQA 8 组，head_dim = 128，80 层。\n' +
			'batch = 32，seq_len = 4096，fp16。\n\n' +
			'KV Cache 总共要占多少 GB？',
		answer: 40,
		unit: 'GB',
		tolerance: 0.5,
		hint: '公式：2 × batch × seq × layers × kv_heads × head_dim × 2 bytes。GQA 下 kv_heads = groups = 8。',
		explanation:
			'2 × 32 × 4096 × 80 × 8 × 128 × 2 bytes\n' +
			'= 2 × 32 × 4096 × 80 × 8 × 128 × 2\n' +
			'= 42,949,672,960 bytes ≈ 40.0 GB\n\n' +
			'这是 KV Cache 关卡的核心公式，现在套进了真实部署参数。'
	},

	// ── Q2: 权重 + KV Cache 总显存，能不能放进 8×A100（来自 kv-cache）──
	{
		kind: 'choice',
		id: 'deploy-decision-02-fits-in-memory',
		prompt:
			'Llama 2 70B fp16 权重约 130.4 GB，KV Cache 约 40 GB。\n' +
			'你有 8 × A100 80GB = 640 GB 总显存。\n\n' +
			'权重 + KV Cache = 170.4 GB，占总显存 640 GB 的 26.6%。\n' +
			'但实际部署时，光看总量够不够是不是就能拍板？',
		options: [
			'够了，170.4 < 640，可以直接部署',
			'不够，还要留余量给激活值、CUDA 内核和通信缓冲区',
			'不够，fp16 的 70B 模型根本放不进单张 80GB 卡',
			'够了，但需要用 pipeline parallelism 把模型切到 8 张卡上'
		],
		answerIndex: 3,
		explanation:
			'总量确实 < 640 GB，但 70B 模型单张 80GB 卡放不下（130.4 GB > 80 GB），\n' +
			'必须用 tensor parallelism 或 pipeline parallelism 把模型拆到多张卡上。\n' +
			'选项 A 忽略了单卡瓶颈，选项 B 对了一半但理由不精确，选项 C 说放不进是对的但结论错了（8 卡总量够）。',
		hint: '想想：模型权重 130.4 GB，一张卡只有 80 GB。不拆能行吗？',
		distractorNotes: {
			0: '130.4 GB 的权重超过单张 A100 的 80GB，不拆到多卡上根本启动不了。',
			1: '激活值和缓冲区确实要留余量，但这不是主要瓶颈——主要瓶颈是单卡放不下完整模型。',
			2: '8 卡总共 640 GB，足够放 70B；放不进的是单卡，用并行切分就能解决。'
		}
	},

	// ── Q3: 注意力复杂度（来自 attention 关卡）──
	{
		kind: 'numeric',
		id: 'deploy-decision-03-attention-flops',
		prompt:
			'在单个注意力头上，Q×K^T 的浮点运算量是 2 × seq_len² × head_dim。\n' +
			'Llama 2 70B 有 64 个查询头，80 层。seq_len = 4096，head_dim = 128。\n\n' +
			'整个模型做一次前向传播，所有注意力头的 Q×K^T 共多少 TFLOPS？\n' +
			'（1 TFLOPS = 10¹² 次浮点运算）',
		answer: 21.99,
		unit: 'TFLOPS',
		tolerance: 0.5,
		hint: '每头 2 × 4096² × 128 次运算，乘以 64 头 × 80 层。',
		explanation:
			'每头: 2 × 4096² × 128 = 4,294,967,296 ≈ 4.295 × 10⁹\n' +
			'全模型: 4.295e9 × 64 × 80 = 21,990,232,555,520 ≈ 21.99 × 10¹² = 21.99 TFLOPS\n\n' +
			'这只是 QK^T 一步。还要加上 attn×V（同量级），再加 FFN 层——' +
			'注意力的平方复杂度在 4K 上下文时已经很重，这解释了为什么 Flash Attention 至关重要。'
	},

	// ── Q4: 缩放因子推导（来自 attention 关卡）──
	{
		kind: 'numeric',
		id: 'deploy-decision-04-scale-factor',
		prompt:
			'Llama 2 70B 的 head_dim = 128。\n' +
			'注意力分数要除以 √head_dim 来防止 softmax 饱和。\n\n' +
			'这个缩放因子 1/√d_k 等于多少？（保留 4 位小数）',
		answer: 0.0884,
		unit: '',
		tolerance: 0.0001,
		hint: '1/√128。',
		explanation:
			'1/√128 = 1/11.3137... = 0.08839...\n\n' +
			'不除这个因子，Q×K^T 的值会随 d_k 线性增长，\n' +
			'让 softmax 的输入落入饱和区，梯度消失到接近 0。'
	},

	// ── Q5: INT8 量化收益（来自 kv-cache 关卡的量化部分）──
	{
		kind: 'numeric',
		id: 'deploy-decision-05-int8-kv-saving',
		prompt:
			'如果把 KV Cache 从 fp16（2 bytes）量化到 INT8（1 byte），\n' +
			'上一题算出的 40 GB KV Cache 会变成多少 GB？',
		answer: 20,
		unit: 'GB',
		tolerance: 0.5,
		hint: '字节数减半。',
		explanation:
			'40 GB × (1/2) = 20 GB\n\n' +
			'量化 KV Cache 是最简单的显存优化，代价是每个 token 引入微小的量化误差。' +
			'但在部署决策里，从 40 → 20 GB 让你有空间把 batch 翻倍或上下文加长。'
	},

	// ── Q6: token 效率与成本（来自 tokenizer 关卡）──
	{
		kind: 'numeric',
		id: 'deploy-decision-06-token-cost',
		prompt:
			'Llama 2 的词表大小 32000。一篇中文文档 9000 字，中文字符/token 比约 1.5\n' +
			'（即每 1.5 个中文字产生 1 个 token）。\n\n' +
			'这篇文档会消耗多少 tokens？',
		answer: 6000,
		unit: 'tokens',
		tolerance: 50,
		hint: '9000 / 1.5 = ?',
		explanation:
			'9000 字 ÷ 1.5 字/token = 6000 tokens\n\n' +
			'中文分词效率比英文差：英文约 4 字符/token，中文约 1.5 字符/token。' +
			'同样的「信息量」，中文的 token 成本是英文的 2-3 倍。这在成本估算时不能忽略。'
	},

	// ── Q7: batch × seq 对 KV Cache 的线性影响（跨 kv-cache + tokenizer）──
	{
		kind: 'numeric',
		id: 'deploy-decision-07-halve-batch',
		prompt: '如果把 batch 从 32 减半到 16（其他不变），KV Cache 变成多少 GB？',
		answer: 20,
		unit: 'GB',
		tolerance: 0.5,
		hint: 'KV Cache 与 batch 线性正比。',
		explanation:
			'40 GB × (16/32) = 20 GB\n\n' +
			'KV Cache 公式里 batch 在最前面：减半 batch 就是减半显存。' +
			'但这也意味着吞吐量减半——部署决策往往就是在这两者之间找平衡。'
	},

	// ── Q8: RAG 分块数量（来自 rag-chunking 关卡）──
	{
		kind: 'numeric',
		id: 'deploy-decision-08-rag-chunks',
		prompt:
			'你决定给这个 LLM 加一层 RAG。文档库 100 万字，分块大小 500 字，重叠 50 字。\n\n' +
			'需要索引多少个分块？',
		answer: 2223,
		unit: '个分块',
		tolerance: 5,
		hint: '有效步长 = 块大小 - 重叠 = 450。分块数 = ceil((总长 - 重叠) / 步长)。',
		explanation:
			'有效步长 = 500 - 50 = 450\n' +
			'分块数 = ceil((1,000,000 - 50) / 450) = ceil(999,950 / 450) = ceil(2222.11) = 2223\n\n' +
			'重叠的代价是分块数增加：无重叠是 2000 个，50 字重叠多出约 11%。' +
			'这直接影响向量库大小和检索延迟。'
	},

	// ── Q9: 检索 top-k 对上下文的占用（跨 rag + tokenizer）──
	{
		kind: 'numeric',
		id: 'deploy-decision-09-rag-context-tokens',
		prompt:
			'RAG 检索 top-5 分块（每块 500 字，中文 1.5 字/token），拼进 prompt。\n' +
			'系统提示占 200 tokens，用户问题占 100 tokens。\n\n' +
			'input 总共多少 tokens？（含系统提示 + 检索结果 + 用户问题）',
		answer: 1967,
		unit: 'tokens',
		tolerance: 10,
		hint: '5 块 × 500 字 ÷ 1.5 + 200 + 100。',
		explanation:
			'检索上下文: 5 × 500 / 1.5 = 1666.67 ≈ 1667 tokens\n' +
			'总计: 200 + 1667 + 100 = 1967 tokens\n\n' +
			'4096 的上下文窗口还剩 4096 - 1967 = 2129 tokens 给输出。' +
			'如果分块再大一倍或 top-k 再加，窗口就不够用了——这就是分块大小必须精确规划的原因。'
	},

	// ── Q10: 梯度消失与 ReLU 死区（来自 backprop 关卡的概念）──
	{
		kind: 'choice',
		id: 'deploy-decision-10-dead-relu-inference',
		prompt:
			'Llama 2 70B 在训练时使用 SwiGLU 激活函数而不是 ReLU。\n' +
			'从部署（推理）的角度，为什么这个选择很重要？',
		options: [
			'SwiGLU 推理计算量更小，加速推理',
			'SwiGLU 没有死区问题，不会浪费参数容量',
			'SwiGLU 的梯度恒为 1，加速训练收敛',
			'SwiGLU 允许使用更小的 head_dim'
		],
		answerIndex: 1,
		explanation:
			'ReLU 在负半轴导数恒为 0，一旦神经元进入死区就永远不产生输出——' +
			'对 70B 这种超大模型，死掉的参数等于白占显存。\n' +
			'SwiGLU（门控平滑激活）在全定义域上导数都非零，不会让参数「死掉」。\n' +
			'从部署角度看：同等参数量下有效容量更高，不用为死参数付显存和计算的代价。',
		hint: '想想 ReLU 的「死区」对模型容量意味着什么。',
		distractorNotes: {
			0: 'SwiGLU 比 ReLU 计算量更大（多一次乘法 + sigmoid），不是更小。',
			2: '梯度恒为 1 是 skip connection / residual 的性质，不是 SwiGLU。',
			3: 'head_dim 是注意力的参数，和激活函数无关。'
		}
	}
];
