/**
 * Attention 关卡题库。
 *
 * 与 KV Cache 关卡的定位差异：
 * KV Cache 考「部署时要几张卡」，是容量规划；
 * 这一关考「注意力为什么这样设计」，是机制理解。
 *
 * 所以这一关**没有达标型沙盒**——注意力机制没有 KV Cache 那种
 * 「显存 vs 质量」的天然双约束。按 docs/level-authoring.md 的退路 1，
 * 改成观察型交互（预测再验证），页面上不显示通关判定。
 *
 * 所有数值已用脚本独立验证，见 attention-questions.spec.ts。
 */

import type { Question } from './types';

/** 贯穿本关的基准配置，与题目和测试共用 */
export const ATTENTION_SPEC = {
	heads: 32,
	headDim: 128,
	/** fp16 */
	dtypeBytes: 2
} as const;

export const ATTENTION_QUESTIONS: Question[] = [
	{
		kind: 'numeric',
		id: 'attention-01-matrix-memory',
		prompt:
			'标准注意力要实体化一个 seq_len × seq_len 的分数矩阵。\n\n' +
			'batch = 1，32 个头，seq_len = 4096，fp16。\n\n' +
			'这个分数矩阵占多少 GB？',
		answer: 1,
		unit: 'GB',
		tolerance: 0.05,
		hint: '每个头都有一份完整的 seq × seq 矩阵。公式：batch × heads × seq × seq × bytes。',
		explanation:
			'1 × 32 × 4096 × 4096 × 2 bytes = 1,073,741,824 bytes = 恰好 1.00 GB\n\n' +
			'注意这里**没有 head_dim**。分数矩阵是 Q·Kᵀ 的结果，' +
			'head_dim 在点积中被消掉了，只剩下 token 之间的两两关系。\n\n' +
			'这 1 GB 是纯粹的中间产物——算完 softmax 乘上 V 就没用了。' +
			'Flash Attention 的全部价值就在于不把它写进显存。'
	},
	{
		kind: 'numeric',
		id: 'attention-02-quadratic-growth',
		prompt: '承上题。把 seq_len 从 4096 提到 8192，其他不变。\n\n分数矩阵的显存变成原来的几倍？',
		answer: 4,
		unit: '倍',
		hint: '矩阵的两个维度都是 seq_len。',
		explanation:
			'seq × seq 里 seq 出现两次，所以是**平方关系**：2² = 4 倍。\n\n' +
			'4096 → 1 GB，8192 → 4 GB，16384 → 16 GB。\n\n' +
			'这条平方曲线是长上下文最根本的障碍。' +
			'它解释了为什么「支持 100 万 token 上下文」不可能是标准注意力实现的——' +
			'那需要约 60 TB 的分数矩阵。'
	},
	{
		kind: 'numeric',
		id: 'attention-03-scaling-factor',
		prompt:
			'Q 和 K 的每个分量都是均值 0、方差 1 的独立随机数，head_dim = 64。\n\n' +
			'那么 q·k 点积的标准差约是多少？',
		answer: 8,
		tolerance: 0.5,
		hint: '独立随机变量之和的方差等于方差之和。点积是 64 项乘积的和。',
		explanation:
			'点积是 64 个独立项的和，每项方差为 1，所以总方差 ≈ 64，标准差 ≈ **8 = √64**。\n\n' +
			'这正是缩放因子 1/√d_k 的来历：**它把点积的标准差归一化回 1**。\n\n' +
			'不缩放会怎样？d_k = 128 时标准差约 11.3，' +
			'softmax 的输入被拉到 ±30 这个量级，输出几乎变成 one-hot——' +
			'梯度趋近于 0，训练直接停滞。这不是理论担心，是缩放因子被发明出来的原因。'
	},
	{
		kind: 'choice',
		id: 'attention-04-why-scale',
		prompt: '如果去掉 attention 里的 1/√d_k 缩放，最直接的后果是什么？',
		options: [
			'注意力矩阵占用的显存变大',
			'softmax 趋于饱和，梯度接近 0，训练难以推进',
			'模型无法处理超过 d_k 长度的序列',
			'必须改用 ReLU 替代 softmax'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '缩放只是逐元素乘一个常数，不改变矩阵形状，显存完全不变。',
			2: 'd_k 是每个头的特征维度，与序列长度无关，两者不构成限制关系。',
			3: 'softmax 本身没有问题，问题在输入的数值范围。换激活函数是答非所问。'
		},
		explanation:
			'点积的方差随 d_k 线性增长，标准差随 √d_k 增长。' +
			'不缩放时 softmax 的输入分布过宽，输出退化成接近 one-hot。\n\n' +
			'softmax 在饱和区的导数趋近于 0——**梯度消失**，反向传播传不回有效信号。\n\n' +
			'这也是为什么缩放因子是 √d_k 而不是 d_k：' +
			'要抵消的是标准差的增长，不是方差的增长。'
	},
	{
		kind: 'numeric',
		id: 'attention-05-causal-waste',
		prompt:
			'因果掩码把分数矩阵的上三角（未来位置）全部屏蔽掉。\n\n' +
			'seq_len = 4096 时，实际有效的元素占全矩阵的百分之多少？',
		answer: 50,
		unit: '%',
		tolerance: 0.5,
		hint: '下三角含对角线的元素个数是 n(n+1)/2。',
		explanation:
			'n(n+1)/2 ÷ n² = (n+1)/2n。n = 4096 时约 **50.01%**。\n\n' +
			'也就是说，朴素实现算了一整个矩阵，**一半的结果直接扔掉**。\n\n' +
			'这是 Flash Attention 之外的另一块优化空间：' +
			'按块跳过完全被掩码的区域，可以省掉接近一半的计算。' +
			'注意 n 很小时浪费比例更高（n=4 时有效率 62.5%），' +
			'但序列一长就迅速收敛到 50%。'
	},
	{
		kind: 'choice',
		id: 'attention-06-flash-mechanism',
		prompt: 'Flash Attention 大幅降低显存占用，主要靠什么？',
		options: [
			'把分数矩阵量化成低精度存储',
			'分块计算并在线累积 softmax，从不实体化完整的分数矩阵',
			'用稀疏模式跳过大部分 token 对',
			'把分数矩阵卸载到主机内存'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '量化会损失精度，而 Flash Attention 的结果与标准实现**数值等价**，不是近似方法。',
			2: '跳过 token 对是稀疏注意力的做法，会改变计算结果。Flash 算的是完整注意力。',
			3: '卸载会让本就受带宽限制的注意力更慢。Flash 的思路正相反——尽量留在片上高速内存里。'
		},
		explanation:
			'Flash Attention 把 Q、K、V 切成能装进 SRAM 的小块，' +
			'逐块计算并用在线 softmax 增量地维护归一化因子，' +
			'因此**永远不需要把 seq × seq 的矩阵写进显存**。\n\n' +
			'关键性质：它是**精确的**，不是近似。' +
			'这让它可以无条件替换标准实现——不需要重新训练，不损失质量。\n\n' +
			'代价是实现复杂且依赖特定硬件的内存层级，' +
			'所以它是一个 kernel 级优化，而不是模型结构的改变。'
	},
	{
		kind: 'numeric',
		id: 'attention-07-flash-savings',
		prompt:
			'seq_len = 8192，32 个头，head_dim = 128，fp16。\n\n' +
			'分数矩阵是 4 GB；Q、K、V、输出四个张量合计 0.25 GB。\n\n' +
			'如果完全不实体化分数矩阵，注意力部分的显存降为原来的几分之一？换算成节省倍数是多少倍？',
		answer: 17,
		unit: '倍',
		tolerance: 0.5,
		hint: '原来是「分数矩阵 + 四个张量」，之后只剩四个张量。',
		explanation:
			'(4 + 0.25) ÷ 0.25 = **17 倍**。\n\n' +
			'换个角度看更直观：分数矩阵占了注意力总显存的 94%。' +
			'省掉它几乎等于省掉全部。\n\n' +
			'这个比值随 seq_len 增大还会继续上升，' +
			'因为分数矩阵是平方增长而 Q/K/V/O 是线性增长——' +
			'序列越长，Flash Attention 越不可替代。'
	},
	{
		kind: 'numeric',
		id: 'attention-08-sliding-window',
		prompt:
			'滑动窗口注意力让每个 token 只看前 w 个位置。\n\n' +
			'seq_len = 8192，窗口 w = 256，其他条件同上题。\n\n' +
			'相比全注意力，分数矩阵的显存省了几倍？',
		answer: 32,
		unit: '倍',
		tolerance: 1,
		hint: '矩阵形状从 seq × seq 变成 seq × w。',
		explanation:
			'8192 ÷ 256 = **32 倍**。\n\n' +
			'滑动窗口把平方复杂度降成线性——代价是**彻底看不到窗口外的内容**。\n\n' +
			'这与 Flash Attention 有本质区别：Flash 是精确的实现优化，' +
			'滑动窗口是**近似**，会改变模型能力。' +
			'实践中常用混合策略（部分层全注意力、部分层滑窗）来平衡，' +
			'Mistral 和 Gemma 都用过这个思路。'
	},
	{
		kind: 'choice',
		id: 'attention-09-sliding-tradeoff',
		prompt: '一个模型全部层都用 256 的滑动窗口，最可能在哪类任务上明显退化？',
		options: [
			'逐字翻译短句',
			'判断一段文字的情感倾向',
			'回答需要引用文档开头信息的长文问答',
			'续写符合语法的句子'
		],
		answerIndex: 2,
		distractorNotes: {
			0: '逐字翻译的依赖基本都在邻近上下文里，窗口 256 完全够用。',
			1: '情感判断依赖局部的情绪词与句式，长程依赖不是关键。',
			3: '语法正确性是典型的局部约束，窗口内的信息足以支撑。'
		},
		explanation:
			'长文问答要求把答案位置与文档开头的信息关联起来，' +
			'这个距离往往远超 256——信息在窗口外，模型物理上看不到。\n\n' +
			'这就是「大海捞针」（needle in a haystack）测试要考的东西，' +
			'也是滑窗模型在该测试上容易暴露短板的原因。\n\n' +
			'反过来说，如果你的业务全是短程依赖（分类、抽取、改写），' +
			'滑窗带来的成本下降几乎是免费的。**先看任务再选架构。**'
	},
	{
		kind: 'code',
		id: 'attention-c1-softmax',
		prompt:
			'实现数值稳定的 softmax。\n\n' +
			'直接写 exp(x) / sum(exp(x)) 在数学上没错，但输入里有 1000 这种值时' +
			'`math.exp` 会直接溢出报错。\n\n' +
			'标准做法是先减去最大值——这不改变结果（分子分母同乘一个常数），却能避免溢出。',
		setupCode: 'import math\n',
		starterCode: `def softmax(xs):
    """返回与 xs 等长的列表，元素为非负数且和为 1。"""
    # TODO: 记得先减去最大值再取指数
    raise NotImplementedError("请实现 softmax")
`,
		solutionCode: `def softmax(xs):
    """返回与 xs 等长的列表，元素为非负数且和为 1。"""
    m = max(xs)
    exps = [math.exp(x - m) for x in xs]
    total = sum(exps)
    return [e / total for e in exps]
`,
		tests: [
			{
				label: '输出和为 1',
				code: `r = softmax([1.0, 2.0, 3.0])
assert abs(sum(r) - 1.0) < 1e-9, f"和应为 1，得到 {sum(r)}"`
			},
			{
				label: '全部元素非负',
				code: `r = softmax([-5.0, 0.0, 5.0])
assert all(v >= 0 for v in r), f"存在负值：{r}"`
			},
			{
				label: '保持大小顺序',
				code: `r = softmax([1.0, 3.0, 2.0])
assert r[1] > r[2] > r[0], f"顺序不对：{r}"`
			},
			{
				label: '相等输入得到均匀分布',
				code: `r = softmax([7.0, 7.0, 7.0, 7.0])
assert all(abs(v - 0.25) < 1e-9 for v in r), f"应为 0.25 均分，得到 {r}"`
			},
			{
				label: '大数值不溢出（这是减最大值的意义）',
				code: `r = softmax([1000.0, 1001.0, 1002.0])
assert abs(sum(r) - 1.0) < 1e-9, f"大数值下和应仍为 1，得到 {sum(r)}"
assert r[2] > r[1] > r[0], "大数值下顺序也应保持"`
			},
			{
				label: '平移不变性：整体加常数结果不变',
				code: `a = softmax([1.0, 2.0, 3.0])
b = softmax([101.0, 102.0, 103.0])
assert all(abs(x - y) < 1e-9 for x, y in zip(a, b)), \\
    f"softmax 应对平移不变，得到 {a} 与 {b}"`
			}
		],
		hint: '先 m = max(xs)，再对每个元素算 math.exp(x - m)，最后除以它们的和。',
		explanation:
			'```python\nm = max(xs)\nexps = [math.exp(x - m) for x in xs]\ntotal = sum(exps)\nreturn [e / total for e in exps]\n```\n\n' +
			'减去最大值之后，最大的指数项恰好是 exp(0) = 1，其余都在 (0, 1] 内，' +
			'**不可能溢出**。而分子分母同乘 exp(-m)，结果与原式完全相同。\n\n' +
			'这就是「平移不变性」那条测试在验证的东西。' +
			'真实推理框架里这一步是标配——logits 经常出现 ±30 以上的值，' +
			'朴素实现会直接抛 OverflowError。'
	},
	{
		kind: 'code',
		id: 'attention-c2-causal-mask',
		prompt:
			'实现因果掩码。\n\n' +
			'自回归模型不能看未来：位置 i 只允许注意到 j ≤ i 的位置。\n\n' +
			'做法是把未来位置的分数设成负无穷，这样过完 softmax 后权重恰好为 0。\n\n' +
			'返回一个新的二维列表，不要修改传入的 scores。',
		setupCode: 'import math\n\nNEG_INF = float("-inf")\n',
		starterCode: `def apply_causal_mask(scores):
    """scores 是 n×n 的二维列表。把 j > i 的位置置为负无穷。"""
    # TODO: 已提供常量 NEG_INF
    raise NotImplementedError("请实现 apply_causal_mask")
`,
		solutionCode: `def apply_causal_mask(scores):
    """scores 是 n×n 的二维列表。把 j > i 的位置置为负无穷。"""
    n = len(scores)
    return [
        [scores[i][j] if j <= i else NEG_INF for j in range(n)]
        for i in range(n)
    ]
`,
		tests: [
			{
				label: '第一行只保留第一个元素',
				code: `m = apply_causal_mask([[1.0, 2.0], [3.0, 4.0]])
assert m[0][0] == 1.0, f"m[0][0] 应保持 1.0，得到 {m[0][0]}"
assert m[0][1] == NEG_INF, f"m[0][1] 应为 -inf，得到 {m[0][1]}"`
			},
			{
				label: '最后一行全部保留',
				code: `m = apply_causal_mask([[1.0, 2.0], [3.0, 4.0]])
assert m[1][0] == 3.0 and m[1][1] == 4.0, f"最后一行应完整保留，得到 {m[1]}"`
			},
			{
				label: '对角线永远可见',
				code: `s = [[float(i * 4 + j) for j in range(4)] for i in range(4)]
m = apply_causal_mask(s)
for i in range(4):
    assert m[i][i] != NEG_INF, f"位置 ({i},{i}) 不该被屏蔽"`
			},
			{
				label: '被屏蔽的元素个数正确',
				code: `n = 5
s = [[1.0] * n for _ in range(n)]
m = apply_causal_mask(s)
masked = sum(1 for row in m for v in row if v == NEG_INF)
expected = n * (n - 1) // 2
assert masked == expected, f"应屏蔽 {expected} 个，实际 {masked} 个"`
			},
			{
				label: '不修改原始输入',
				code: `s = [[1.0, 2.0], [3.0, 4.0]]
apply_causal_mask(s)
assert s == [[1.0, 2.0], [3.0, 4.0]], f"原始 scores 被改动了：{s}"`
			},
			{
				label: '掩码后过 softmax，未来位置权重为 0',
				code: `def _sm(xs):
    finite = [x for x in xs if x != NEG_INF]
    mx = max(finite) if finite else 0.0
    es = [0.0 if x == NEG_INF else math.exp(x - mx) for x in xs]
    t = sum(es)
    return [e / t for e in es]

m = apply_causal_mask([[1.0, 5.0], [2.0, 3.0]])
w = _sm(m[0])
assert abs(w[0] - 1.0) < 1e-9, f"第一行应全部注意力给自己，得到 {w}"
assert abs(w[1]) < 1e-12, f"未来位置权重应为 0，得到 {w[1]}"`
			}
		],
		hint: '用嵌套列表推导：外层遍历 i，内层遍历 j，j <= i 时取原值，否则取 NEG_INF。',
		explanation:
			'```python\nn = len(scores)\nreturn [\n    [scores[i][j] if j <= i else NEG_INF for j in range(n)]\n    for i in range(n)\n]\n```\n\n' +
			'为什么用负无穷而不是 0？因为掩码作用在 **softmax 之前**。' +
			'设成 0 的话 exp(0) = 1，那个位置反而会拿到可观的权重；' +
			'设成 -inf 则 exp(-inf) = 0，权重严格为零。\n\n' +
			'最后那条测试验证的就是这件事：掩码后第一行的注意力 100% 给自己，' +
			'未来位置精确为 0。\n\n' +
			'实际实现里通常用 -1e9 而不是真正的 -inf，' +
			'因为 -inf 参与某些运算会产生 NaN。但道理是一样的。'
	}
];
