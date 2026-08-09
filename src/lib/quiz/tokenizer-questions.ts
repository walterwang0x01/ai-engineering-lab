/**
 * Tokenizer 与成本题库。
 *
 * 能力目标：能估算一段文本的 token 数与 API 成本，
 * 并解释为什么中文和代码的 token 效率差很多。
 *
 * 出题原则：
 * 1. 分词算法本身的数值（如 BPE 合并频次）可以精确计算，照抄自 BPE 手工推导例子
 * 2. 中文/英文的字符-token 比例只有公开经验区间，题目里的换算标注为估算
 * 3. 成本、上下文容量类题目给定单价和 token 数，是纯算术，可以精确计算
 * 4. 单价均为假设值，不声称是某家真实价格
 *
 * 贯穿题库的两条公开经验比例（均为估算，非精确值）：
 *   英文 ≈ 4 字符/token
 *   中文 ≈ 1.5～1 字符/token（即约 0.67～1 token/字）
 */

import type { Question } from './types';

/** 贯穿题库的假设单价与经验比例，供 spec 复用 */
export const TOKENIZER_ASSUMPTIONS = {
	/** 英文经验比例：约 4 字符/token（公开经验值，非精确值） */
	enCharsPerToken: 4,
	/** 中文经验比例区间：1～1.5 字/token（公开经验值，非精确值） */
	zhCharsPerTokenRange: [1, 1.5] as const
} as const;

export const TOKENIZER_QUESTIONS: Question[] = [
	{
		kind: 'numeric',
		id: 'tokenizer-01-bpe-merge-freq',
		prompt:
			'BPE 训练语料词频：{"low":5, "lower":2, "newest":6, "widest":3}（`</w>` 表示词尾，未画出）。\n\n' +
			'第一轮统计所有相邻符号对的共现频次（按词频加权），\n' +
			'"newest" 和 "widest" 中都出现的字符对 (e,s) 共现频次最高。\n\n' +
			'这个最高频次是多少？',
		answer: 9,
		hint: '(e,s) 只在 "newest" 和 "widest" 里出现，把这两个词的词频加起来。',
		explanation:
			'"newest" 词频 6，"widest" 词频 3，(e,s) 在两个词里各出现一次，\n' +
			'所以频次 = 6 + 3 = **9**，是第一轮里所有相邻对中最高的，因此被选中合并成 "es"。\n\n' +
			'BPE 的合并规则完全由这套贪心统计决定：**每一步都合并当前语料里频次最高的相邻对**，\n' +
			'不看语义、不看词典，只看统计。这也是为什么同一份语料训练两次会得到完全相同的合并顺序——' +
			'算法是确定性的，随机性只存在于语料本身。'
	},
	{
		kind: 'choice',
		id: 'tokenizer-02-wordpiece-vs-bpe',
		prompt:
			'BPE 和 WordPiece 都是"迭代合并相邻符号对"，但选择合并哪一对的打分公式不同：\n\n' +
			'BPE：score(A,B) = count(A,B)\n' +
			'WordPiece：score(A,B) = count(A,B) / (count(A) × count(B))\n\n' +
			'WordPiece 这个分母带来的效果是什么？',
		options: [
			'优先合并出现次数最多的两个符号，不管它们各自多常见',
			'优先合并"关联性强"的对：即便共现次数不算最高，只要相对各自独立出现的期望频率高得多也会被选中',
			'完全等价于 BPE，只是换了一种数学表达方式',
			'强制优先合并高频词，压制低频词被选中的机会'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '这描述的正好是 BPE 的策略（分子单独就是共现次数），WordPiece 恰恰是用分母去修正这一点。',
			2: '两者结果不同：BPE 会被超高频片段主导前几轮合并顺序，WordPiece 会优先挑"强关联但各自频率适中"的片段，实际训练出的合并顺序不一样。',
			3: '效果正相反——分母是 count(A)×count(B)，A、B 各自越高频，分母越大，分数反而被压低。'
		},
		explanation:
			'这个公式和点互信息 PMI = log[P(A,B)/(P(A)·P(B))] 结构一致（没取 log），\n' +
			'本质是问："A、B 相邻出现的频率，是否比它们各自独立出现的期望频率高得多？"\n\n' +
			'两个超高频词（如 "the" 和 "ing"）即便共现次数不低，分母会把分数拉得很低——' +
			'"两个常见词凑在一起"本来就该常发生，不代表值得合并成一个新符号。\n' +
			'反过来两个各自不那么高频、但只要出现就几乎总相邻的对，会得到很高分数。\n\n' +
			'这解释了 BERT（WordPiece）和 GPT/Llama（BPE）训练出的词表为何有不同的"性格"。'
	},
	{
		kind: 'choice',
		id: 'tokenizer-03-byte-level-bpe',
		prompt:
			'GPT 系列采用字节级 BPE（byte-level BPE），而非在 Unicode 字符上直接做 BPE。这主要解决了什么问题？',
		options: [
			'让分词速度更快',
			'让中文分词效果比字符级 BPE 更好',
			'基础符号表固定为 256（字节范围），任何语言的任何字符都能先编码成字节，永不 OOV',
			'减少训练语料所需的存储空间'
		],
		answerIndex: 2,
		distractorNotes: {
			0: '字节级 BPE 不是为了速度设计的，编码步骤本身和字符级 BPE 复杂度相近。',
			1: '效果相反：中文汉字在 UTF-8 下常占 3 字节，没被合并成一个 token 时会被切成 3 个碎片，比合适的字符级方案更容易切碎中文。',
			3: '字节级 BPE 影响的是分词的基础符号表设计，跟训练语料的存储空间无关。'
		},
		explanation:
			'普通 BPE 在字符层面操作，基础符号表要覆盖所有可能的 Unicode 字符（数万到十万级），\n' +
			'遇到没见过的字符（生僻字、emoji）仍会 OOV。\n\n' +
			'字节级 BPE 先把文本用 UTF-8 编码成字节序列，在字节（0~255，固定 256 种）上做 BPE 合并——' +
			'不管输入什么语言，都能先表示成字节再编码，**永不 OOV**。这是 GPT 系列选择它的核心原因。\n\n' +
			'代价是中文这类多字节字符如果没被训练语料充分合并，会被切成 2~3 个 token，' +
			'这正是"中文 token 效率低于英文"的一个直接成因（见下面几道成本题）。'
	},
	{
		kind: 'numeric',
		id: 'tokenizer-04-chinese-efficiency-ratio',
		prompt:
			'公开经验比例（均为估算，非某个具体模型的精确值）：\n' +
			'英文约 4 字符/token；中文约 1.5 字/token。\n\n' +
			'同样字符数的一段英文和一段中文，中文消耗的 token 数约是英文的几倍？',
		answer: 2.67,
		tolerance: 0.1,
		hint: '英文 400 字符 ≈ 100 token；中文 400 字算 ≈ 多少 token？两者相除。',
		explanation:
			'400 字符英文 ≈ 400 ÷ 4 = 100 token。\n' +
			'400 字中文 ≈ 400 ÷ 1.5 ≈ 266.7 token。\n' +
			'266.7 ÷ 100 ≈ **2.67 倍**。\n\n' +
			'⚠️ 这是**估算**：真实压缩比取决于具体分词器的训练语料和词表大小，' +
			'没有放之四海而皆准的精确数字。但方向是稳定的——' +
			'以英语为主训练的分词器，中文的字符/token 比例明显低于英文，' +
			'意味着同等信息量下中文用户的 token 账单更高，能塞进上下文窗口的实际内容也更少。'
	},
	{
		kind: 'numeric',
		id: 'tokenizer-05-api-cost-basic',
		prompt:
			'假设某 API 的输入价格为 $0.5 / 1M input tokens（假设值，非任何厂商真实价格）。\n\n' +
			'一次请求消耗 2,000,000 input tokens，这次请求的输入成本是多少美元？',
		answer: 1,
		unit: '美元',
		tolerance: 0.01,
		hint: '2,000,000 ÷ 1,000,000 × 0.5。',
		explanation:
			'2,000,000 ÷ 1,000,000 × $0.5 = **$1.00**\n\n' +
			'这是最基础的成本公式：成本 = (token 数 ÷ 1,000,000) × 单价。\n' +
			'记住这个换算，后面几道题都是它的变体——加上缓存折扣、拆成输入输出两段计价，\n' +
			'本质都是同一个乘法。'
	},
	{
		kind: 'numeric',
		id: 'tokenizer-06-context-window-turns',
		prompt:
			'某模型上下文窗口为 128,000 tokens。\n' +
			'一轮对话（用户提问 + 模型回答）平均消耗 800 tokens。\n\n' +
			'不考虑滑动截断，这个窗口理论上最多能容纳多少轮完整对话？',
		answer: 160,
		hint: '128000 除以 800。',
		explanation:
			'128,000 ÷ 800 = **160 轮**\n\n' +
			'这是长对话/多轮 Agent 场景的容量规划算法：窗口大小 ÷ 每轮平均 token 数。\n' +
			'实际能用的轮数会更少——系统提示词、工具调用结果、历史摘要都要占一部分预算，\n' +
			'生产系统通常只把窗口的 70%~90% 当作可用预算，剩下的留作缓冲。'
	},
	{
		kind: 'numeric',
		id: 'tokenizer-07-cache-savings-ratio',
		prompt:
			'假设某 API 未缓存的 input 单价是 $3 / 1M tokens，命中 prompt cache 后单价是 $0.3 / 1M tokens\n' +
			'（假设值，非任何厂商真实价格）。\n\n' +
			'处理同样 100,000 tokens 的输入，缓存命中相比不缓存，成本降为原来的几分之一？\n' +
			'（换算成"不缓存成本 ÷ 缓存成本"的倍数回答）',
		answer: 10,
		unit: '倍',
		hint: '两种情况下的 token 数相同，只是单价不同，倍数就是单价之比。',
		explanation:
			'不缓存成本 = 100,000 ÷ 1,000,000 × $3 = $0.30\n' +
			'缓存命中成本 = 100,000 ÷ 1,000,000 × $0.3 = $0.03\n' +
			'$0.30 ÷ $0.03 = **10 倍**\n\n' +
			'因为 token 数不变，倍数其实就等于两个单价的比值（$3 ÷ $0.3 = 10），\n' +
			'不需要算出具体成本再相除。这个结论可以推广：**只要 token 数相同，缓存节省的倍数只取决于价格比，\n' +
			'与请求量、文档长度都无关**——这也是为什么"提高缓存命中率"是几乎所有长上下文应用的第一优化项，\n' +
			'收益是可预测的乘法关系，不用反复实测。'
	},
	{
		kind: 'choice',
		id: 'tokenizer-08-vocab-size-tradeoff',
		prompt: '把分词器的词表从 32K 扩大到 128K，对模型的直接影响是什么？',
		options: [
			'序列变长，因为大词表切出更多 token',
			'序列变短（同样文本用更少 token），但 embedding 层和输出层的参数量随之增长',
			'只影响训练速度，不影响推理时的实际计算量',
			'词表越大，模型对未见过的词的处理能力越差'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '方向反了。词表越大，越多常见词/短语能被表示为单个 token，同样文本切出的 token 数通常更少而非更多。',
			2: '词表大小改变 embedding 矩阵和输出层（到词表大小的 softmax）的参数量和计算量，这些在训练和推理阶段都存在，推理时的采样也要过这个 softmax。',
			3: '子词分词器的 OOV 处理能力主要取决于是否有字符/字节级兜底，不是词表越大越差；实际上词表更大通常意味着更多常见子词被直接收录，覆盖面更好。'
		},
		explanation:
			'词表大小是"序列长度 vs 参数量"的跷跷板：\n\n' +
			'**小词表**：embedding 参数少、softmax 计算量小，但每个词需要更多 token，' +
			'序列变长导致自注意力的 O(n²) 计算量增加，单 token 语义也更稀薄。\n\n' +
			'**大词表**：常见词/短语能紧凑表示为单个 token，序列更短（省了 Transformer 主体的计算），' +
			'但 embedding 矩阵和输出层参数量随词表大小线性增长，长尾 token 的训练信号也更稀疏。\n\n' +
			'这个权衡没有免费的最优解——多语言模型往往需要更大词表来兼顾各语言的压缩率，\n' +
			'代价是输出层的 softmax 计算与参数量也跟着涨上去。'
	},
	{
		kind: 'code',
		id: 'tokenizer-c1-cost-estimator',
		prompt:
			'实现一个 API 成本估算函数。\n\n' +
			'给定输入 token 数、输出 token 数，以及输入/输出各自的单价（美元 / 1M tokens），\n' +
			'返回总成本（美元）。\n\n' +
			'公式：总成本 = 输入部分成本 + 输出部分成本，每部分 = (token 数 ÷ 1,000,000) × 对应单价。',
		setupCode: '',
		starterCode: `def estimate_cost(input_tokens, output_tokens, price_in_per_1m, price_out_per_1m):
    """返回总成本（美元），四个参数均为非负数。"""
    # TODO: 分别算输入和输出的成本，再相加
    raise NotImplementedError("请实现 estimate_cost")
`,
		solutionCode: `def estimate_cost(input_tokens, output_tokens, price_in_per_1m, price_out_per_1m):
    """返回总成本（美元），四个参数均为非负数。"""
    cost_in = input_tokens / 1_000_000 * price_in_per_1m
    cost_out = output_tokens / 1_000_000 * price_out_per_1m
    return cost_in + cost_out
`,
		tests: [
			{
				label: '基础计算：500000 输入 tokens @ $0.5/1M',
				code: `c = estimate_cost(500_000, 0, 0.5, 1.5)
assert c > 0, "成本应大于 0"
assert abs(c - 0.25) < 1e-9, f"应为 0.25，得到 {c}"`
			},
			{
				label: '输入输出分别计价，两部分都要算上',
				code: `c = estimate_cost(500_000, 100_000, 0.5, 1.5)
assert c > 0, "成本应大于 0"
assert abs(c - 0.4) < 1e-9, f"500000/1M*0.5 + 100000/1M*1.5 = 0.4，得到 {c}"`
			},
			{
				label: '输出单价通常高于输入单价时，输出部分成本贡献更大',
				code: `c_output_heavy = estimate_cost(0, 1_000_000, 1.0, 5.0)
c_input_heavy = estimate_cost(1_000_000, 0, 1.0, 5.0)
assert c_output_heavy > 0 and c_input_heavy > 0, "两个成本都应大于 0"
assert c_output_heavy > c_input_heavy, \\
    f"输出单价更高时，同样 token 数的输出成本应更贵，得到 {c_output_heavy} vs {c_input_heavy}"`
			},
			{
				label: 'token 数为 0 时成本为 0',
				code: `c = estimate_cost(0, 0, 3.0, 6.0)
assert c == 0, f"零 token 应零成本，得到 {c}"`
			},
			{
				label: '成本随 token 数线性增长：翻倍 token 数应翻倍成本',
				code: `c1 = estimate_cost(200_000, 50_000, 2.0, 4.0)
c2 = estimate_cost(400_000, 100_000, 2.0, 4.0)
assert c1 > 0, "基准成本应大于 0"
assert abs(c2 - 2 * c1) < 1e-9, f"token 数翻倍成本应翻倍，得到 {c1} 与 {c2}"`
			}
		],
		hint: '输入成本 = input_tokens / 1_000_000 * price_in_per_1m，输出成本同理，两者相加。',
		explanation:
			'```python\n' +
			'cost_in = input_tokens / 1_000_000 * price_in_per_1m\n' +
			'cost_out = output_tokens / 1_000_000 * price_out_per_1m\n' +
			'return cost_in + cost_out\n' +
			'```\n\n' +
			'这个函数看似简单，但"输入输出分开计价"这件事本身就是一个常被忽略的成本陷阱——' +
			'很多人心算成本时只按一个价位估，而输出单价通常是输入单价的数倍（模型生成比读取贵）。\n\n' +
			'"成本随 token 数线性增长"这条性质意味着**省 token 的收益是可预测的**：' +
			'压缩输入 10%，成本大致也降 10%，不存在边际效应。'
	},
	{
		kind: 'code',
		id: 'tokenizer-c2-bpe-merge-step',
		prompt:
			'实现 BPE 训练里的一步：给定词频统计（词已经切成符号列表），\n' +
			'找出当前语料里频次最高的相邻符号对。\n\n' +
			'输入 `word_freqs` 是一个字典：键是符号元组（如 `("l","o","w")`），值是该词的出现频次。\n' +
			'需要统计每个词内部所有相邻符号对的频次（按词频加权累加到全局），返回频次最高的那一对。\n\n' +
			'如果语料里没有任何长度 ≥ 2 的词（无法组成相邻对），返回 `None`。',
		setupCode: '',
		starterCode: `def most_frequent_pair(word_freqs):
    """word_freqs: dict[tuple[str, ...], int]。返回频次最高的相邻符号对 (a, b)，无相邻对时返回 None。"""
    # TODO: 遍历每个词，统计相邻符号对的加权频次，找出最高的
    raise NotImplementedError("请实现 most_frequent_pair")
`,
		solutionCode: `def most_frequent_pair(word_freqs):
    """word_freqs: dict[tuple[str, ...], int]。返回频次最高的相邻符号对 (a, b)，无相邻对时返回 None。"""
    pair_freqs = {}
    for word, freq in word_freqs.items():
        for i in range(len(word) - 1):
            pair = (word[i], word[i + 1])
            pair_freqs[pair] = pair_freqs.get(pair, 0) + freq
    if not pair_freqs:
        return None
    return max(pair_freqs, key=lambda p: pair_freqs[p])
`,
		tests: [
			{
				label: '笔记里的手工例子：(e,s) 应以频次 9 胜出',
				code: `freqs = {
    ("l", "o", "w", "</w>"): 5,
    ("l", "o", "w", "e", "r", "</w>"): 2,
    ("n", "e", "w", "e", "s", "t", "</w>"): 6,
    ("w", "i", "d", "e", "s", "t", "</w>"): 3,
}
pair = most_frequent_pair(freqs)
assert pair is not None, "应该能找到一个相邻对"
assert pair == ("e", "s"), f"应为 ('e','s')，得到 {pair}"`
			},
			{
				label: '单一高频词内部的对被正确统计',
				code: `freqs = {("a", "b", "c"): 10}
pair = most_frequent_pair(freqs)
assert pair is not None, "应该能找到一个相邻对"
assert pair in [("a", "b"), ("b", "c")], f"结果应是词内的相邻对之一，得到 {pair}"`
			},
			{
				label: '词频加权：低频词的对不应盖过高频词的对',
				code: `freqs = {("a", "b"): 1, ("c", "d"): 100}
pair = most_frequent_pair(freqs)
assert pair is not None, "应该能找到一个相邻对"
assert pair == ("c", "d"), f"频次 100 的对应胜出，得到 {pair}"`
			},
			{
				label: '同一相邻对在多个词中出现时频次要累加',
				code: `freqs = {
    ("x", "y", "z"): 3,
    ("x", "y"): 4,
}
pair = most_frequent_pair(freqs)
assert pair is not None, "应该能找到一个相邻对"
assert pair == ("x", "y"), f"(x,y) 在两个词里共现 3+4=7 次，应胜出，得到 {pair}"`
			},
			{
				label: '没有任何相邻对时返回 None',
				code: `freqs = {("a",): 5, ("b",): 3}
pair = most_frequent_pair(freqs)
assert pair is None, f"单字符词没有相邻对，应返回 None，得到 {pair}"`
			}
		],
		hint:
			'外层遍历 word_freqs 的每个 (word, freq)，内层用 range(len(word)-1) 取相邻两个符号组成 pair，' +
			'用字典累加 pair_freqs[pair] += freq，最后用 max(..., key=...) 找最大值对应的 key。',
		explanation:
			'```python\n' +
			'pair_freqs = {}\n' +
			'for word, freq in word_freqs.items():\n' +
			'    for i in range(len(word) - 1):\n' +
			'        pair = (word[i], word[i + 1])\n' +
			'        pair_freqs[pair] = pair_freqs.get(pair, 0) + freq\n' +
			'if not pair_freqs:\n' +
			'    return None\n' +
			'return max(pair_freqs, key=lambda p: pair_freqs[p])\n' +
			'```\n\n' +
			'这正是 BPE 训练主循环里最关键的一步——**找出当前最该合并的一对**。\n' +
			'真实实现会在找到这一对之后把语料中所有 "A B" 替换成 "AB"，然后重复这个统计过程，\n' +
			'直到达到目标词表大小。"词频加权"这一点测试专门覆盖到了：\n' +
			'一个低频词内部再"紧密"的组合，也不能盖过一个高频词贡献的巨量共现次数——\n' +
			'BPE 完全是统计驱动的贪心算法，不掺杂任何语言学判断。'
	}
];
