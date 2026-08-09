/**
 * KV Cache 题库。
 *
 * 出题原则：
 * 1. 每道题都考真实的生产决策，不考名词记忆
 * 2. 所有数值已用脚本验证（见 explanation 里的推导）
 * 3. 错误选项来自真实的常见误解，不是凑数
 *
 * 核心公式贯穿全部题目：
 *   KV Cache 字节数 = 2 × batch × seq_len × layers × kv_heads × head_dim × bytes_per_element
 *   其中 2 是因为要同时缓存 K 和 V
 */

import type { Question } from './types';

/** 两个贯穿题库的真实模型配置 */
export const MODEL_SPECS = {
	llama3_8b: {
		label: 'Llama 3 8B',
		layers: 32,
		heads: 32,
		headDim: 128,
		gqaGroups: 8,
		/** fp16 权重占用，8e9 × 2 / 1024³ */
		weightGiB: 14.9
	},
	llama2_70b: {
		label: 'Llama 2 70B',
		layers: 80,
		heads: 64,
		headDim: 128,
		gqaGroups: 8,
		weightGiB: 130.4
	}
} as const;

export const KV_CACHE_QUESTIONS: Question[] = [
	{
		kind: 'numeric',
		id: 'kv-cache-01-gqa-baseline',
		prompt:
			'Llama 3 8B：32 层，32 个查询头，head_dim = 128，GQA 分 8 组。\nbatch = 1，seq_len = 8192，fp16。\n\nKV Cache 占多少 GB？',
		answer: 1,
		unit: 'GB',
		tolerance: 0.05,
		hint: '别忘了 K 和 V 各存一份，公式最前面有个 ×2。GQA 下 kv_heads 用的是组数 8，不是 32。',
		explanation:
			'2 × 1 × 8192 × 32 × 8 × 128 × 2 bytes = 1,073,741,824 bytes = 恰好 1.00 GB\n\n' +
			'把这个数字记住：**8B 模型在 8K 上下文下，每个并发请求约吃 1 GB**。' +
			'这是做容量规划时最有用的心算基准。'
	},
	{
		kind: 'numeric',
		id: 'kv-cache-02-mha-contrast',
		prompt:
			'同样的 Llama 3 8B 配置，如果不用 GQA，改成标准 MHA（32 个 KV 头）。\nbatch = 1，seq_len = 8192，fp16。\n\nKV Cache 占多少 GB？',
		answer: 4,
		unit: 'GB',
		tolerance: 0.1,
		hint: 'kv_heads 从 8 变成 32，其他都不变。',
		explanation:
			'2 × 1 × 8192 × 32 × **32** × 128 × 2 bytes = 4.00 GB\n\n' +
			'只改了 kv_heads 一个参数，显存翻了 4 倍。' +
			'这就是 Llama 2 的 7B 用 MHA、Llama 3 的 8B 改用 GQA 的直接原因——' +
			'同样的卡能塞进 4 倍的并发。'
	},
	{
		kind: 'numeric',
		id: 'kv-cache-03-savings-ratio',
		prompt: '32 个查询头分成 8 组的 GQA，相比标准 MHA，KV Cache 节省几倍？',
		answer: 4,
		unit: '倍',
		hint: '这个比值只取决于两个数。',
		explanation:
			'32 ÷ 8 = 4 倍。\n\n' +
			'节省倍数 = num_heads ÷ num_kv_heads，**与 batch、seq_len、层数、精度全都无关**。\n' +
			'两个极端：num_kv_heads = num_heads 就是 MHA（不省），num_kv_heads = 1 就是 MQA（省 num_heads 倍）。' +
			'GQA 是这条线段上的可调点。'
	},
	{
		kind: 'choice',
		id: 'kv-cache-04-mqa-tradeoff',
		prompt: 'MQA（所有查询头共享同一组 KV）相比 GQA，最主要的代价是什么？',
		options: [
			'显存占用反而更大',
			'模型质量下降更明显',
			'推理延迟显著升高',
			'必须重新预训练，无法从 MHA 转换'
		],
		answerIndex: 1,
		distractorNotes: {
			0: 'MQA 的显存是最省的（kv_heads = 1），方向反了。',
			2: 'MQA 显存带宽压力更小，延迟通常更低而非更高。',
			3: 'MQA 和 GQA 都可以从已有 MHA 模型做 uptraining 转换（对 KV 头做均值池化后少量继续训练），不需要从零预训练。'
		},
		explanation:
			'MQA 把所有查询头压到一组 KV，表达能力损失最大，质量下降比 GQA 明显。\n\n' +
			'GQA 的价值正在于它是折中：分组数取 8 这类中间值，' +
			'既拿到接近 MQA 的显存收益，又把质量损失控制在可接受范围。' +
			'这也是 Llama 3、Mistral 等主流模型选 GQA 而不选 MQA 的原因。'
	},
	{
		kind: 'numeric',
		id: 'kv-cache-05-70b-serving',
		prompt:
			'Llama 2 70B：80 层，64 个查询头，head_dim = 128，GQA 分 8 组。\n生产环境 batch = 32，seq_len = 4096，fp16。\n\nKV Cache 占多少 GB？',
		answer: 40,
		unit: 'GB',
		tolerance: 1,
		hint: '层数从 32 变 80，batch 从 1 变 32，都是线性关系。',
		explanation:
			'2 × 32 × 4096 × 80 × 8 × 128 × 2 bytes = 40.0 GB\n\n' +
			'**同样配置若用 MHA（64 个 KV 头）会是 320 GB** —— 4 张 80GB A100 全部用来放缓存都不够。\n' +
			'GQA 不是优化，是让 70B 能在合理成本下被服务的前提条件。'
	},
	{
		kind: 'numeric',
		id: 'kv-cache-06-int8-quant',
		prompt:
			'承上题（70B、GQA 8 组、batch = 32、seq_len = 4096，原本 40 GB）。\n把 KV Cache 从 fp16 量化到 int8。\n\n现在占多少 GB？',
		answer: 20,
		unit: 'GB',
		tolerance: 0.5,
		hint: 'bytes_per_element 从 2 变成 1。',
		explanation:
			'40 GB × (1 byte ÷ 2 bytes) = 20.0 GB\n\n' +
			'KV Cache 量化是纯线性收益，且比权重量化更安全——' +
			'KV 只影响注意力的检索精度，不像权重量化会累积误差。\n' +
			'实践中 int8 KV Cache 的质量损失通常小于 1%，是性价比最高的一档优化。'
	},
	{
		kind: 'choice',
		id: 'kv-cache-07-scaling-behavior',
		prompt:
			'部署时观察到：并发请求从 1 涨到 32，模型权重占用完全不变，但总显存快速逼近上限。\n主要原因是什么？',
		options: [
			'权重被复制了多份，每个请求一份',
			'KV Cache 随 batch 线性增长，而权重是所有请求共享的',
			'激活值（activation）占用随 batch 平方增长',
			'显存碎片导致可用空间虚高'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '权重是只读的，所有并发请求共享同一份，不会复制。',
			2: '激活值随 batch 是线性而非平方增长，且推理时激活值远小于 KV Cache。',
			3: '碎片确实存在（这正是 PagedAttention 要解决的），但它是次要因素，量级上解释不了主要增长。'
		},
		explanation:
			'显存分三块：**权重（固定）+ KV Cache（随 batch × seq 线性增长）+ 激活值（较小）**。\n\n' +
			'这个结构决定了推理服务的核心矛盾：权重是一次性成本，KV Cache 是边际成本。' +
			'所以提升吞吐的工程重点几乎全在压 KV Cache 上——GQA、量化、PagedAttention、prefix caching 都是。'
	},
	{
		kind: 'numeric',
		id: 'kv-cache-08-crossover-batch',
		prompt:
			'Llama 3 8B，fp16 权重约 14.9 GB，seq_len = 8192 时每个请求的 KV Cache 约 1 GB。\n\nbatch 达到多少时，KV Cache 总量开始超过模型权重本身？',
		answer: 15,
		tolerance: 1,
		hint: '两者相等的临界点在哪里？',
		explanation:
			'14.9 GB ÷ 1 GB/batch ≈ 14.9，所以 **batch ≈ 15 时 KV Cache 追上权重**。\n\n' +
			'这个临界点的意义：在此之上，你的显存主要不是被"模型"占着，而是被"对话历史"占着。' +
			'很多人凭直觉以为大模型部署的瓶颈是权重，' +
			'但只要并发上到两位数，KV Cache 就成了主角——优化重点必须跟着转移。'
	},
	{
		kind: 'choice',
		id: 'kv-cache-09-paged-attention',
		prompt: 'vLLM 的 PagedAttention 主要解决 KV Cache 的哪个问题？',
		options: [
			'降低 KV Cache 的总字节数',
			'把 KV Cache 从显存卸载到主机内存',
			'消除因预分配定长空间导致的显存碎片与浪费',
			'让 KV Cache 可以在多张卡之间共享'
		],
		answerIndex: 2,
		distractorNotes: {
			0: '这是 GQA/MQA 和量化的职责。PagedAttention 不改变单个 token 的 KV 大小。',
			1: '卸载（offloading）是另一类技术。PagedAttention 的分页发生在显存内部。',
			3: '跨卡切分属于张量并行/序列并行的范畴，不是 PagedAttention 解决的问题。'
		},
		explanation:
			'传统实现按 max_seq_len 预分配定长缓冲，实际请求长度参差不齐，' +
			'浪费可达 60–80%。\n\n' +
			'PagedAttention 借用操作系统虚拟内存分页的思路：把 KV Cache 切成固定大小的块，' +
			'按需分配、用页表映射。**它省的不是理论字节数，而是碎片**——' +
			'因此可以和 GQA、量化叠加使用，收益互不重叠。'
	},
	{
		kind: 'numeric',
		id: 'kv-cache-10-capacity-planning',
		prompt:
			'单张 80 GB A100 部署 Llama 3 8B（fp16 权重 14.9 GB）。\nseq_len = 8192 时每请求 KV Cache 约 1 GB。\n为激活值和运行时开销预留 8 GB。\n\n理论最大并发 batch 是多少？',
		answer: 57,
		tolerance: 2,
		hint: '先算出留给 KV Cache 的空间，再除以每请求的占用。',
		explanation:
			'80 − 14.9（权重）− 8（预留）= 57.1 GB 可用于 KV Cache\n' +
			'57.1 ÷ 1 GB/请求 ≈ **57 个并发**\n\n' +
			'这就是容量规划的完整链路。实际部署还要再打折扣：' +
			'请求长度不均、需要为突发流量留缓冲、PagedAttention 的块粒度也有少量开销。' +
			'但这个算法给出的上界，是判断"要几张卡"的起点。'
	}
];
