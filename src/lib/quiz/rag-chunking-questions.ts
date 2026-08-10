/**
 * RAG 分块与检索质量题库。
 *
 * 能力目标：能在召回率、噪声、成本之间找到可行区间，
 * 并解释为什么「分块越小越精确」是错的。
 *
 * 出题原则：
 * 1. chunk 数量、重叠带来的额外 token、向量存储量、嵌入成本、
 *    上下文窗口占用 —— 这些是纯算术，可以精确计算
 * 2. 召回率、噪声比这类依赖具体模型和评测集的指标，
 *    题目里的数字标注为「示意性估算」
 * 3. 单价、维度等参数取自 embedding 模型的公开规格（如 text-embedding-3-small
 *    的 1536 维），单价本身仍标注为假设值，不声称是某厂商真实价格
 *
 * 内容依据：learning-notes/00-ai/04-ai-agent/06-RAG进阶/
 *   01-RAG架构与核心流程.md（RecursiveCharacterTextSplitter 的
 *     chunk_size/chunk_overlap 参数、text-embedding-3-small 1536 维）
 *   03-高级RAG策略.md（Contextual Retrieval：为每个 chunk 生成上下文前缀，
 *     每个 chunk 都要重复付一次这笔开销）
 */

import type { Question } from './types';

/** 贯穿题库的共享参数，供 spec 复用做独立重算 */
export const RAG_CHUNKING_ASSUMPTIONS = {
	/** 中文经验比例：约 1.5 字/token（公开经验值，非精确值，与 tokenizer 题库一致） */
	zhCharsPerToken: 1.5,
	/** 假设的 embedding 单价，非任何厂商真实价格 */
	embedPricePerMillion: 0.02,
	/** text-embedding-3-small 的向量维度（公开规格） */
	embeddingDim: 1536,
	/** float32 每维占用字节数 */
	bytesPerDim: 4
} as const;

export const RAG_CHUNKING_QUESTIONS: Question[] = [
	{
		kind: 'numeric',
		id: 'rag-chunking-01-chunk-count',
		prompt:
			'一份文档共 10,000 字符，用滑动窗口分块：chunk_size = 500 字符，chunk_overlap = 50 字符。\n' +
			'（即每块前进的步长 = chunk_size − chunk_overlap = 450 字符）\n\n' +
			'这份文档会被分成多少个 chunk？（向上取整）',
		answer: 23,
		hint: '第一块占满 500 字符，之后每块新增 450 字符。总块数 = ceil((10000 − 500) / 450) + 1。',
		explanation:
			'步长 = 500 − 50 = 450。\n' +
			'第一块覆盖前 500 字符，剩余需要覆盖 10000 − 500 = 9500 字符。\n' +
			'后续还需要的块数 = ceil(9500 / 450) = ceil(21.11) = 22。\n' +
			'总块数 = 第一块 1 个 + 后续 22 个 = **23**。\n\n' +
			'这是滑动窗口分块最基础的公式：n = ceil((总字符数 − chunk_size) / 步长) + 1。' +
			'步长（而不是 chunk_size）才是决定块数的关键——重叠越大，步长越小，' +
			'同样的文档会被切出更多块，这是下一题要算的"重叠代价"的来源。'
	},
	{
		kind: 'numeric',
		id: 'rag-chunking-02-overlap-extra-tokens',
		prompt:
			'同一份文档分块后得到 23 个 chunk，chunk_overlap = 50 字符，中文经验比例约 1.5 字/token（示意性估算）。\n\n' +
			'除第一个 chunk 外，其余每个 chunk 都比"零重叠方案"多存了一段 50 字符的重复内容。\n' +
			'这些重叠部分总共额外消耗了多少 token？（四舍五入到整数）',
		answer: 733,
		tolerance: 5,
		hint: '额外重叠的总字符数 = (chunk数 − 1) × overlap，再除以字符/token 比例。',
		explanation:
			'额外重叠字符数 = (23 − 1) × 50 = 1100 字符。\n' +
			'换算成 token（示意性估算，1.5 字/token）= 1100 ÷ 1.5 ≈ **733 token**。\n\n' +
			'这就是重叠的直接代价：重叠比例越高，同一段内容被编码进相邻 chunk 的次数越多，' +
			'嵌入阶段和检索阶段都要为这部分冗余多付一次 token。重叠不是免费的"保险"——' +
			'它在用可预测的 token 开销换取"边界信息不丢失"，这笔账必须算进总成本，不能只看召回率的提升。'
	},
	{
		kind: 'numeric',
		id: 'rag-chunking-03-vector-storage',
		prompt:
			'用 text-embedding-3-small（1536 维，公开规格）为知识库生成向量，共 8,000 个 chunk，\n' +
			'每个维度用 float32（4 字节）存储，暂不考虑索引结构的额外开销。\n\n' +
			'存储这些向量本身需要多少 MB？（1 MB = 1024×1024 字节，保留整数）',
		answer: 47,
		tolerance: 1,
		hint: '总字节数 = chunk数 × 维度 × 4 字节，再换算成 MB。',
		explanation:
			'总字节数 = 8000 × 1536 × 4 = 49,152,000 字节。\n' +
			'换算成 MB = 49,152,000 ÷ (1024×1024) ≈ **46.9 ≈ 47 MB**。\n\n' +
			'这是精确计算（给定维度和精度），但只是"裸向量"的存储量——HNSW 等索引结构\n' +
			'通常还要再叠加 1.2～2 倍的图结构开销，实际部署的存储占用会明显更高。' +
			'维度越大（如 text-embedding-3-large 的 3072 维），这笔存储成本翻倍，' +
			'这也是"要不要用更大 embedding 模型"这个决策里经常被忽略的一项。'
	},
	{
		kind: 'numeric',
		id: 'rag-chunking-04-embedding-cost',
		prompt:
			'知识库文档总计 3,000,000 字符，chunk_size = 400，chunk_overlap = 0（简化：不考虑重叠），\n' +
			'中文经验比例约 1.5 字/token（示意性估算）。\n' +
			'假设 embedding 单价为 $0.02 / 1M tokens（假设值，非任何厂商真实价格）。\n\n' +
			'把全部 chunk 嵌入一次，总成本是多少美元？（保留 2 位小数）',
		answer: 0.04,
		tolerance: 0.005,
		hint: 'chunk 数 ≈ 总字符数 / chunk_size（overlap=0 时可直接整除估算），再算总 token 数和成本。',
		explanation:
			'chunk 数 = 3,000,000 ÷ 400 = 7500 个。\n' +
			'每个 chunk 的 token 数（示意性估算）= 400 ÷ 1.5 ≈ 266.67。\n' +
			'总 token 数 = 7500 × 266.67 ≈ 2,000,000。\n' +
			'总成本 = 2,000,000 ÷ 1,000,000 × $0.02 = **$0.04**。\n\n' +
			'⚠️ token 数本身依赖"中文字符/token"的示意性估算比例，成本公式和单价换算是精确的。\n' +
			'这笔账说明：**分块粒度不影响总字符数，理论上也几乎不影响总 token 数和嵌入成本**\n' +
			'（overlap=0 时，chunk 数和单 chunk token 数成反比，乘积近似不变）——' +
			'纯嵌入成本本身很便宜，真正被分块粒度显著推高的成本，\n' +
			'是"每个 chunk 单独调用一次 LLM"这类按次计费的环节（如生成上下文前缀），\n' +
			'这一关的沙盒会把这个因素加进来。'
	},
	{
		kind: 'numeric',
		id: 'rag-chunking-05-context-window-occupancy',
		prompt:
			'某模型上下文窗口为 8,000 tokens。检索阶段设置 top_k = 6，\n' +
			'每个命中的 chunk 平均 400 字符，中文经验比例约 1.5 字/token（示意性估算）。\n\n' +
			'把这 6 个 chunk 全部塞进 prompt，会占用上下文窗口的百分之多少？（保留整数）',
		answer: 20,
		tolerance: 1,
		unit: '%',
		hint: '6 个 chunk 的总字符数除以 1.5 得到总 token 数，再除以窗口大小。',
		explanation:
			'6 个 chunk 总字符数 = 6 × 400 = 2400 字符。\n' +
			'总 token 数（示意性估算）= 2400 ÷ 1.5 = 1600 token。\n' +
			'占用比例 = 1600 ÷ 8000 = **20%**。\n\n' +
			'这提示一个常被忽视的约束：top_k 和 chunk_size 是联合决定"检索结果占多少上下文预算"的两个变量。\n' +
			'提高 top_k 想换更高召回率，或者放大 chunk_size 想让每块信息更完整，\n' +
			'都会直接推高这个占用比例——挤占的是系统提示词、对话历史和模型输出的预算，\n' +
			'不是无成本的选择。'
	},
	{
		kind: 'choice',
		id: 'rag-chunking-06-small-chunk-myth',
		prompt: '"分块越小，检索越精确" 这个说法为什么是错的？',
		options: [
			'分块越小，向量维度会自动降低，语义表达能力下降',
			'分块太小会把一个完整的语义单元切碎，单个 chunk 可能只包含半句话，\n本身就不构成完整语义，嵌入向量表达的信息不完整，召回反而下降',
			'分块越小，embedding 模型的计算复杂度呈指数增长，导致检索延迟不可接受',
			'分块越小会导致向量数据库索引失效，必须重建整个索引'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '向量维度由 embedding 模型决定（如 text-embedding-3-small 固定 1536 维），与 chunk 大小无关，chunk 变小不会改变模型输出的维度。',
			2: 'embedding 的计算复杂度大致与输入长度线性相关，chunk 变小意味着每次调用输入更短、计算更快，不是指数增长；真正增加的是调用次数（chunk 数量），是线性增长而非指数。',
			3: '索引结构（如 HNSW）不关心具体 chunk 的语义完整性，插入更多小向量不会导致索引"失效"，只是需要更多存储和构建时间。'
		},
		explanation:
			'检索质量的核心是"chunk 的向量能不能代表一个完整、独立的语义单元"。\n' +
			'chunk 太小时（比如把一句话切成两半），每个 chunk 单独嵌入后失去了完整语境，\n' +
			'向量表征变得模糊或指向错误的主题——检索时既容易漏掉真正相关的内容（召回下降），\n' +
			'也容易命中看似相关但实际残缺的片段（噪声上升）。\n\n' +
			'另一个常被忽略的代价：chunk 越小，chunk 总数越多。如果流程里有\n' +
			'"每个 chunk 单独调用一次 LLM"的步骤（比如 Contextual Retrieval 生成上下文前缀），\n' +
			'chunk 数暴增会让这笔按次计费的成本线性甚至更快地增长——\n' +
			'"更精确"的直觉和"更贵、召回未必更好"的现实同时发生，这才是权衡的本质。'
	},
	{
		kind: 'choice',
		id: 'rag-chunking-07-overlap-purpose',
		prompt: 'chunk_overlap（分块重叠）主要解决什么问题？',
		options: [
			'减少向量数据库的存储占用',
			'避免语义相关的内容恰好落在两个 chunk 的切分边界上，导致任何一个 chunk 单独看都不完整',
			'加快 embedding 模型的推理速度',
			'让检索时的 top_k 参数可以设置得更小'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '重叠是重复存储部分内容，overlap 越大存储占用越多，方向正好相反。',
			2: '重叠让每个 chunk 变相变长（body + 重复的边界内容），推理时输入更长、更慢，不是更快。',
			3: 'overlap 和 top_k 是两个独立维度，overlap 解决的是"切分位置"问题，不直接影响需要检索几个结果。'
		},
		explanation:
			'固定长度分块本质是"盲切"——不管切分点是不是恰好落在一个完整句子或论点中间。\n' +
			'如果关键信息正好横跨切分边界，两个 chunk 各自只拿到半句话，' +
			'嵌入后语义都不完整，检索时可能两个都命中不了。\n\n' +
			'重叠让相邻 chunk 共享一段内容，降低"关键信息恰好被切成两半"的概率——' +
			'但代价是上一题算过的：重叠部分被重复编码、重复存储，是用确定的 token/存储开销\n' +
			'去换取"边界信息不丢失"的概率提升，不是没有代价的纯收益。'
	},
	{
		kind: 'choice',
		id: 'rag-chunking-08-chunking-tradeoff-triangle',
		prompt: '实践中调整分块粒度时，召回率、噪声比、处理成本三者的关系最准确的描述是？',
		options: [
			'三者相互独立，可以分别单独调到各自的最优值',
			'不存在能同时让三者都最优的分块粒度：偏小提升召回但推高成本（chunk 数暴增），\n偏大降低成本但混入更多不相关内容（噪声上升），必须在中间地带找可行区间',
			'只要召回率达标，噪声和成本会自动跟着达标',
			'处理成本只取决于文档总字符数，与分块粒度无关'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '三者由同一组参数（chunk_size、overlap）联合决定，调大或调小任一参数会同时影响三者，不能独立优化。',
			2: '召回率达标不意味着噪声或成本达标——例如可以用极小的 chunk 把召回率推得很高，但代价是 chunk 数暴增导致按次计费的成本远超预算。',
			3: '总字符数固定时，chunk 数量仍随 chunk_size 变化（chunk 越小，chunk 数越多），如果流程中有"每个 chunk 单独付费"的步骤，处理成本就会随分块粒度显著变化。'
		},
		explanation:
			'这正是这一关沙盒要体现的核心权衡：chunk_size 和 overlap 这两个参数\n' +
			'同时驱动召回率、噪声比、处理成本三条曲线，而且驱动方向经常互相矛盾——\n' +
			'没有一个分块粒度能让三者同时达到各自的最优值。\n\n' +
			'工程实践中能做的不是"找最优点"，而是先定义每个约束的可接受区间' +
			'（如"召回率不低于 X"“成本不超过 Y”），再在参数空间里搜可行区间，\n' +
			'找不到可行解时就要重新考虑约束本身是否合理，而不是无限加大或减小 chunk_size。'
	},
	{
		kind: 'code',
		id: 'rag-chunking-c1-overlapping-chunks',
		prompt:
			'实现一个带重叠的滑动窗口分块函数。\n\n' +
			'给定文本 `text`、块大小 `chunk_size`、重叠长度 `overlap`，\n' +
			'返回分块结果列表：从位置 0 开始，每块取 `chunk_size` 个字符，\n' +
			'下一块的起始位置 = 上一块起始位置 + (chunk_size - overlap)，\n' +
			'直到覆盖完整个文本为止（最后一块可以比 chunk_size 短，但不能是空字符串）。\n\n' +
			'要求 `chunk_size > overlap >= 0`，否则步长非正会导致无限循环。',
		setupCode: '',
		starterCode: `def chunk_text(text, chunk_size, overlap):
    """按滑动窗口分块，返回 chunk 字符串列表。

    text: 原始文本
    chunk_size: 每块的字符数
    overlap: 相邻块的重叠字符数，要求 0 <= overlap < chunk_size
    """
    # TODO: 从位置 0 开始，每次取 chunk_size 个字符，
    # 下一块起始位置前进 (chunk_size - overlap)，直到覆盖完 text
    raise NotImplementedError("请实现 chunk_text")
`,
		solutionCode: `def chunk_text(text, chunk_size, overlap):
    """按滑动窗口分块，返回 chunk 字符串列表。

    text: 原始文本
    chunk_size: 每块的字符数
    overlap: 相邻块的重叠字符数，要求 0 <= overlap < chunk_size
    """
    if chunk_size <= overlap or overlap < 0:
        raise ValueError("要求 chunk_size > overlap >= 0")
    if text == "":
        return []

    stride = chunk_size - overlap
    chunks = []
    start = 0
    while start < len(text):
        piece = text[start:start + chunk_size]
        if piece == "":
            break
        chunks.append(piece)
        if start + chunk_size >= len(text):
            break
        start += stride
    return chunks
`,
		tests: [
			{
				label: '无重叠时按 chunk_size 整块切分',
				code: `chunks = chunk_text("abcdefghij", 5, 0)
assert len(chunks) > 0, "应至少产生一个 chunk"
assert chunks == ["abcde", "fghij"], f"应为 ['abcde','fghij']，得到 {chunks}"`
			},
			{
				label: '有重叠时相邻块共享指定长度的重叠内容',
				code: `chunks = chunk_text("abcdefghij", 4, 2)
assert len(chunks) > 0, "应至少产生一个 chunk"
assert chunks[0] == "abcd", f"第一块应为 'abcd'，得到 {chunks[0]}"
assert chunks[1] == "cdef", f"第二块应从位置 2 开始（步长=4-2=2），应为 'cdef'，得到 {chunks[1]}"`
			},
			{
				label: '最后一块允许短于 chunk_size，但不能是空字符串',
				code: `chunks = chunk_text("abcdefg", 3, 0)
assert len(chunks) > 0, "应至少产生一个 chunk"
for c in chunks:
    assert c != "", "不应产生空字符串的 chunk"
assert chunks[-1] == "g", f"最后一块应为 'g'，得到 {chunks[-1]}"`
			},
			{
				label: '拼接校验：块数应等于按步长覆盖全文所需的块数',
				code: `text = "x" * 97
chunk_size, overlap = 10, 3
stride = chunk_size - overlap
chunks = chunk_text(text, chunk_size, overlap)
assert len(chunks) > 0, "应至少产生一个 chunk"
import math
expected_n = math.ceil((len(text) - chunk_size) / stride) + 1
assert len(chunks) == expected_n, \\
    f"块数应为 {expected_n}（按滑窗公式），得到 {len(chunks)}"`
			},
			{
				label: '重叠部分的内容必须真正重复，不是简单截断',
				code: `chunks = chunk_text("0123456789", 6, 3)
assert len(chunks) >= 2, "这个例子应产生至少 2 个 chunk 才能验证重叠"
overlap_from_first = chunks[0][-3:]
overlap_from_second = chunks[1][:3]
assert overlap_from_first == overlap_from_second, \\
    f"第一块末尾 3 字符应等于第二块开头 3 字符，得到 {overlap_from_first!r} vs {overlap_from_second!r}"`
			},
			{
				label: '空字符串输入返回空列表',
				code: `chunks = chunk_text("", 5, 1)
assert chunks == [], f"空文本应返回空列表，得到 {chunks}"`
			}
		],
		hint:
			'用 while 循环，start 从 0 开始，每次切片 text[start:start+chunk_size]，' +
			'用 stride = chunk_size - overlap 更新 start；注意在 start+chunk_size 达到或超过文本长度时，' +
			'加入最后一块后要跳出循环，避免重复添加或死循环。',
		explanation:
			'```python\n' +
			'stride = chunk_size - overlap\n' +
			'chunks = []\n' +
			'start = 0\n' +
			'while start < len(text):\n' +
			'    piece = text[start:start + chunk_size]\n' +
			'    if piece == "":\n' +
			'        break\n' +
			'    chunks.append(piece)\n' +
			'    if start + chunk_size >= len(text):\n' +
			'        break\n' +
			'    start += stride\n' +
			'return chunks\n' +
			'```\n\n' +
			'这个函数就是 `RecursiveCharacterTextSplitter(chunk_size=..., chunk_overlap=...)` 的\n' +
			'核心机制的简化版本。测试里"重叠部分内容必须真正重复"这一条专门排查一个常见 bug：\n' +
			'很多人会把 overlap 理解成"少切一部分"而不是"和上一块重复共享一部分"，\n' +
			'这两种实现在块数上可能一样，但检索时的效果完全不同——\n' +
			'只有真正共享内容，才能达到"关键信息不会被切在边界上丢失"的设计目的。'
	}
];
