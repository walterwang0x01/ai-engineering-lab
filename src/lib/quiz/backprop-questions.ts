/**
 * 反向传播与死亡 ReLU 题库。
 *
 * 出题原则：
 * 1. 用同一个固定的小网络贯穿全部数值题，手算链式法则，而不是抽象地问公式
 * 2. 死亡 ReLU 不是抽象概念，是这个网络里真实发生的事——h2 在给定输入下恒为 0
 * 3. 所有数值已用脚本验证（见 backprop-questions.spec.ts 的独立重算）
 *
 * 网络结构（贯穿全部题目）：
 *   z1 = w11·x1 + w12·x2 + b1     h1 = ReLU(z1)
 *   z2 = w21·x1 + w22·x2 + b2     h2 = ReLU(z2)
 *   out = v1·h1 + v2·h2 + c
 *   L = (out - y)²
 *
 * 固定参数：w11=0.5 w12=0.5 b1=0.2 w21=0.3 w22=0.4 b2=-1.5 v1=2 v2=-1 c=0.1
 * 固定输入：x1=1 x2=2 y=1
 *
 * 在这组参数下：z1=1.7>0（h1 存活），z2=-0.4<0（h2 死亡）——
 * 这就是本关卡要考的核心现象：同一层里，一个神经元活着，另一个已经死了。
 */

import type { Question } from './types';

/** 贯穿本关的固定网络参数，题目与测试共用 */
export const BACKPROP_NET = {
	w11: 0.5,
	w12: 0.5,
	b1: 0.2,
	w21: 0.3,
	w22: 0.4,
	b2: -1.5,
	v1: 2.0,
	v2: -1.0,
	c: 0.1
} as const;

/** 贯穿本关的固定输入样本 */
export const BACKPROP_INPUT = { x1: 1.0, x2: 2.0, y: 1.0 } as const;

export const BACKPROP_QUESTIONS: Question[] = [
	{
		kind: 'numeric',
		id: 'backprop-01-loss-grad',
		prompt:
			'固定网络：\n' +
			'z1 = 0.5·x1 + 0.5·x2 + 0.2，h1 = ReLU(z1)\n' +
			'z2 = 0.3·x1 + 0.4·x2 − 1.5，h2 = ReLU(z2)\n' +
			'out = 2·h1 − 1·h2 + 0.1\n' +
			'L = (out − y)²\n\n' +
			'输入 x1=1，x2=2，y=1。\n\n' +
			'先算出 out 的值，再算 ∂L/∂out。',
		answer: 5,
		tolerance: 0.01,
		hint: '先算 z1、z2，判断哪个 ReLU 打开了，再算 out。∂L/∂out = 2(out − y)。',
		explanation:
			'z1 = 0.5×1 + 0.5×2 + 0.2 = 1.7 > 0 → h1 = 1.7\n' +
			'z2 = 0.3×1 + 0.4×2 − 1.5 = −0.4 < 0 → h2 = 0（这个神经元已经死了，后面会反复用到）\n' +
			'out = 2×1.7 − 1×0 + 0.1 = 3.5\n\n' +
			'∂L/∂out = 2(out − y) = 2×(3.5 − 1) = **5**\n\n' +
			'这是链式法则的起点：损失对输出的导数，后面每一层的梯度都是这个数往前乘出来的。'
	},
	{
		kind: 'numeric',
		id: 'backprop-02-alive-weight-grad',
		prompt:
			'承上题（out=3.5，∂L/∂out=5，h1=1.7 存活，h2=0 已死）。\n\n' +
			'用链式法则算 ∂L/∂w11（连接 x1 到存活神经元 h1 的权重）。\n\n' +
			'提示链路：∂L/∂w11 = ∂L/∂out · ∂out/∂h1 · ∂h1/∂z1 · ∂z1/∂w11',
		answer: 10,
		tolerance: 0.01,
		hint: "∂out/∂h1 = v1 = 2；∂h1/∂z1 = ReLU'(z1)，z1>0 所以是 1；∂z1/∂w11 = x1 = 1。四项相乘。",
		explanation:
			'∂L/∂out = 5\n' +
			'∂out/∂h1 = v1 = 2\n' +
			"∂h1/∂z1 = ReLU'(z1) = 1（因为 z1=1.7>0）\n" +
			'∂z1/∂w11 = x1 = 1\n\n' +
			'∂L/∂w11 = 5 × 2 × 1 × 1 = **10**\n\n' +
			'这条链完整走了「输出 → 加权求和 → 激活 → 线性层 → 权重」五个节点，' +
			'每一步都是局部导数，乘起来就是全局梯度——这正是反向传播省掉数值微分的地方：' +
			'这些局部导数在前向时已经顺手能拿到（v1、z1 都是缓存值），不需要额外的前向传播。'
	},
	{
		kind: 'numeric',
		id: 'backprop-03-dead-relu-grad',
		prompt:
			'同一个网络，同一次前向传播（z2 = −0.4，h2 = 0）。\n\n' +
			'算 ∂L/∂z2 —— 也就是死亡神经元 h2 的误差项 δ2。',
		answer: 0,
		tolerance: 0,
		hint: "∂L/∂z2 = ∂L/∂h2 · ReLU'(z2)。z2 < 0 时 ReLU 的导数是多少？",
		explanation:
			'∂L/∂h2 = ∂L/∂out · v2 = 5 × (−1) = −5（这一项本身不是 0）\n\n' +
			"但 ReLU'(z2)：z2 = −0.4 < 0，落在 ReLU 的负区间，导数恒为 0。\n\n" +
			'∂L/∂z2 = −5 × 0 = **0**\n\n' +
			'这就是死亡 ReLU 的数学本质：不是"没有误差传过来"（−5 明明不是 0），' +
			'而是**误差传到这个神经元时被 ReLU 的导数硬生生截断成 0**。' +
			'上游有多大的误差信号都无关紧要，乘上 0 就是 0。'
	},
	{
		kind: 'numeric',
		id: 'backprop-04-dead-relu-weight-grad',
		prompt: '承上题（δ2 = ∂L/∂z2 = 0）。\n\n算 ∂L/∂w21（连接 x1 到死亡神经元 h2 的权重）。',
		answer: 0,
		tolerance: 0,
		hint: '∂L/∂w21 = δ2 · ∂z2/∂w21 = δ2 · x1。δ2 已经是 0 了。',
		explanation:
			'∂L/∂w21 = δ2 × x1 = 0 × 1 = **0**\n\n' +
			'同理 ∂L/∂w22 = δ2 × x2 = 0，∂L/∂b2 = δ2 = 0——' +
			'**这个神经元的全部三个参数（w21、w22、b2）梯度都是 0**。\n\n' +
			'梯度下降更新公式是 `w ← w − η·∂L/∂w`，梯度为 0 意味着这一步参数完全不更新。' +
			'如果下一个样本的 z2 仍然小于 0（很可能，因为参数没变），下次梯度还是 0。' +
			'这个神经元就这样永久卡住——这才是"死亡"这个词的准确含义：不是输出恒为 0，' +
			'是**参数再也无法被梯度下降修正**。'
	},
	{
		kind: 'numeric',
		id: 'backprop-05-revival-threshold',
		prompt:
			'固定 x2=2，w21=0.3，w22=0.4，b2=−1.5 不变，只调 x1。\n\n' +
			'z2 = 0.3·x1 + 0.4×2 − 1.5\n\n' +
			'x1 至少要变到多少，才能让 z2 从负数变成 0（h2 开始有非零梯度的临界点）？',
		answer: 2.33,
		tolerance: 0.02,
		hint: '令 z2 = 0，解出 x1。',
		explanation:
			'0.3·x1 + 0.8 − 1.5 = 0\n' +
			'0.3·x1 = 0.7\n' +
			'x1 = 0.7 / 0.3 ≈ **2.33**\n\n' +
			'这道题的意义：死亡不是永久判决，只要**输入分布**变化到能把 z2 推回正区间，' +
			'神经元就能重新获得梯度。但如果权重和 bias 是靠梯度下降学出来的，' +
			'而梯度恒为 0，这个"输入分布恰好穿越回正区间"的机会只能来自数据本身的变化，' +
			'不能来自训练——这正是死亡 ReLU 危险的地方：**训练没有能力自己修复它**。'
	},
	{
		kind: 'choice',
		id: 'backprop-06-why-scaled-diff',
		prompt:
			'同一层里，h1 存活（z1=1.7）、h2 死亡（z2=−0.4），两者的输入 x1、x2 完全相同。为什么会出现分化？',
		options: [
			'因为 h1 和 h2 使用了不同的激活函数',
			'因为 h1 和 h2 各自的权重与偏置不同，导致对同一输入算出的加权和落在了 ReLU 的两侧',
			'因为反向传播对不同神经元采用不同的学习率',
			'因为 h2 的输入 x1、x2 被做了归一化处理'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '两者都是 ReLU，题目里从未切换激活函数。',
			2: '本题的网络没有引入逐神经元学习率的机制，反向传播算的是梯度，不涉及学习率差异。',
			3: 'x1、x2 是同一对输入，直接喂给两个神经元，没有做任何预处理。'
		},
		explanation:
			'z1 = w11·x1 + w12·x2 + b1，z2 = w21·x1 + w22·x2 + b2——公式结构相同，' +
			'但 (w11,w12,b1) = (0.5, 0.5, 0.2) 和 (w21,w22,b2) = (0.3, 0.4, −1.5) 是两组独立的参数。\n\n' +
			'同一个输入，经过不同的线性组合，可能落在 ReLU 的两侧。' +
			'z1 = 1.7 落在正区间，z2 = −0.4 落在负区间——**分化的原因纯粹是参数不同，与输入本身无关**。\n\n' +
			'这解释了为什么死亡 ReLU 往往只发生在"部分"神经元上：偏置特别负、或权重被训练推向' +
			'某个使输出恒为负的方向的那些神经元先死，其余神经元可能仍然健康。'
	},
	{
		kind: 'choice',
		id: 'backprop-07-chain-rule-mechanism',
		prompt:
			"多层网络里，第 l 层的误差项按 δ^(l) = [(W^(l+1))ᵀ·δ^(l+1)] ⊙ σ'(z^(l)) 往前递推。\n\n" +
			"如果某一层里几乎所有神经元的 σ'(z^(l)) 都恒为 0（比如大量 ReLU 死亡），会发生什么？",
		options: [
			'只影响这一层自身的参数更新，更早的层不受影响',
			'这一层变成了"梯度断路点"，比它更早的所有层都收不到有效梯度',
			'反向传播会自动跳过这一层，继续正常传给更早的层',
			'只会让训练变慢，最终仍能收到正常大小的梯度'
		],
		answerIndex: 1,
		distractorNotes: {
			0: '递推公式是链式的，δ^(l) 参与计算 δ^(l-1)。这一层的 δ 若大面积为 0，会直接乘进更早层的误差项里。',
			2: '反向传播是固定的数学过程，不会"跳过"某一层——它只会诚实地把 0 传下去。',
			3: '"传给更早层的梯度"和"变慢"是两件事：这里是梯度被乘上 0，是数值上的归零，不是速度变慢。'
		},
		explanation:
			"递推式里 δ^(l) 是 δ^(l-1) 计算的输入之一。如果某一层几乎全员 σ'(z^(l))=0，" +
			'那么 δ^(l) 里对应位置全为 0，继续往前乘的时候，(W^(l))ᵀ·δ^(l) 这一项会失去这部分信息——\n\n' +
			'**这一层就成了梯度传播路径上的一个"断路点"**：不管更早的层算出什么，' +
			'到这一层全部被截断为 0，再往前传的也是 0。\n\n' +
			'这就是"死亡 ReLU 大面积出现会让网络有效容量萎缩"的机制来源——' +
			'不只是这层的参数学不动，比它更浅的层也会因此失去有效的学习信号。'
	},
	{
		kind: 'choice',
		id: 'backprop-08-leaky-relu-fix',
		prompt:
			'LeakyReLU 用负区间固定小斜率 α（如 0.01）取代 ReLU 的硬截断。它是怎么防止死亡 ReLU 的？',
		options: [
			'让正区间的导数从 1 提升到大于 1，加快学习速度',
			'让负区间的导数从恒为 0 变为恒为 α（非零），死亡神经元仍能接收到微弱梯度',
			'把所有负值直接归零后重新初始化权重',
			'在训练中动态跳过导数为 0 的神经元，只更新健康神经元'
		],
		answerIndex: 1,
		distractorNotes: {
			0: 'LeakyReLU 正区间导数仍是 1，与 ReLU 完全一致，没有改变正区间的行为。',
			2: 'LeakyReLU 不做归零，也不涉及重新初始化，它是把负区间的映射从"恒0"换成"α·z"。',
			3: 'LeakyReLU 不需要"跳过"机制——它从数学上保证了导数处处非零，不存在需要跳过的死神经元。'
		},
		explanation:
			"LeakyReLU'(z) = 1（z>0）或 α（z≤0），α 是像 0.01 这样的固定小常数。\n\n" +
			"对比本关的死亡场景：z2 = −0.4，ReLU'(z2) = 0，∂L/∂w21 = δ2·x1 = 0——彻底卡死。\n" +
			"换成 LeakyReLU：LeakyReLU'(z2) = 0.01（非零），δ2 = −5 × 0.01 = −0.05，" +
			'∂L/∂w21 = −0.05 × 1 = −0.05——**仍然很小，但不是 0**，梯度下降依然能一点点修正这个神经元。\n\n' +
			'这就是"给负区间留一条活路"的准确含义：不追求负区间的输出有多大意义，' +
			'只追求导数不为 0，让梯度下降有机会把参数从当前的死区拉出来。'
	},
	{
		kind: 'code',
		id: 'backprop-c1-relu-and-grad',
		prompt:
			'实现 ReLU 及其导数。\n\n' +
			'ReLU(z) = max(0, z)\n' +
			"ReLU'(z) = 1 (z > 0)，否则 0（z = 0 处按惯例取 0）\n\n" +
			'这两个函数是死亡 ReLU 检测的基础：只要 relu_grad(z) 对某个神经元的 z 恒为 0，它就是死的。',
		setupCode: '',
		starterCode: `def relu(z):
    """z 是单个浮点数，返回 max(0, z)。"""
    # TODO
    raise NotImplementedError("请实现 relu")


def relu_grad(z):
    """z 是单个浮点数。z > 0 返回 1.0，否则返回 0.0。"""
    # TODO
    raise NotImplementedError("请实现 relu_grad")
`,
		solutionCode: `def relu(z):
    """z 是单个浮点数，返回 max(0, z)。"""
    return max(0.0, z)


def relu_grad(z):
    """z 是单个浮点数。z > 0 返回 1.0，否则返回 0.0。"""
    return 1.0 if z > 0 else 0.0
`,
		tests: [
			{
				label: 'relu 在正数上恒等',
				code: `r = relu(1.7)
assert r == 1.7, f"relu(1.7) 应为 1.7，得到 {r}"`
			},
			{
				label: 'relu 在负数上归零',
				code: `r = relu(-0.4)
assert r == 0.0, f"relu(-0.4) 应为 0.0，得到 {r}"`
			},
			{
				label: 'relu 在 0 处为 0',
				code: `r = relu(0.0)
assert r == 0.0, f"relu(0.0) 应为 0.0，得到 {r}"`
			},
			{
				label: 'relu_grad 在正数上为 1',
				code: `g = relu_grad(1.7)
assert g == 1.0, f"relu_grad(1.7) 应为 1.0，得到 {g}"`
			},
			{
				label: 'relu_grad 在负数上为 0（死亡区间）',
				code: `g = relu_grad(-0.4)
assert g == 0.0, f"relu_grad(-0.4) 应为 0.0，得到 {g}"`
			},
			{
				label: '用本关网络的两个神经元交叉验证：z1 存活、z2 死亡',
				code: `z1, z2 = 1.7, -0.4
h1, h2 = relu(z1), relu(z2)
assert h1 > 0, f"z1={z1} 应存活（h1>0），得到 h1={h1}"
assert h2 == 0.0, f"z2={z2} 应死亡（h2=0），得到 h2={h2}"
g1, g2 = relu_grad(z1), relu_grad(z2)
assert g1 == 1.0 and g2 == 0.0, f"存活神经元梯度应为1、死亡神经元应为0，得到 g1={g1} g2={g2}"`
			}
		],
		hint: 'relu 用 max(0.0, z)；relu_grad 用一个 if/else 判断 z > 0。',
		explanation:
			'```python\ndef relu(z):\n    return max(0.0, z)\n\n\ndef relu_grad(z):\n    return 1.0 if z > 0 else 0.0\n```\n\n' +
			'这两个函数看起来极简单，但它们就是死亡 ReLU 现象的全部数学根源：' +
			'`relu_grad` 是一个不连续的阶跃函数，负区间处处为 0，没有任何"渐近"或"缓冲"。\n\n' +
			'最后一条测试直接用了本关贯穿始终的网络参数（z1=1.7, z2=−0.4），' +
			'验证同一层里两个神经元真的会分化成"活"与"死"两种状态。'
	},
	{
		kind: 'code',
		id: 'backprop-c2-hidden-layer-backward',
		prompt:
			"实现隐藏层的误差递推 δ^(l) = [(W^(l+1))ᵀ·δ^(l+1)] ⊙ σ'(z^(l))。\n\n" +
			'简化到本关的网络：只有一个隐藏神经元连到输出（标量形式），\n' +
			'delta_out 是标量 ∂L/∂out，v 是该隐藏神经元到输出的权重，z 是该隐藏神经元的加权输入。\n\n' +
			'实现 `hidden_delta(delta_out, v, z)`，返回这个隐藏神经元的 δ = ∂L/∂z。\n\n' +
			'配套实现 `weight_grad(delta, x)`，返回 ∂L/∂w = δ·x。',
		setupCode: `def relu_grad(z):
    return 1.0 if z > 0 else 0.0
`,
		starterCode: `def hidden_delta(delta_out, v, z):
    """delta_out = dL/dout（标量）。v 是隐藏神经元到输出的权重。z 是该隐藏神经元的加权输入。
    返回 dL/dz = delta_out * v * relu_grad(z)。"""
    # TODO
    raise NotImplementedError("请实现 hidden_delta")


def weight_grad(delta, x):
    """delta 是该神经元的 dL/dz，x 是对应的输入分量。返回 dL/dw = delta * x。"""
    # TODO
    raise NotImplementedError("请实现 weight_grad")
`,
		solutionCode: `def hidden_delta(delta_out, v, z):
    """delta_out = dL/dout（标量）。v 是隐藏神经元到输出的权重。z 是该隐藏神经元的加权输入。
    返回 dL/dz = delta_out * v * relu_grad(z)。"""
    return delta_out * v * relu_grad(z)


def weight_grad(delta, x):
    """delta 是该神经元的 dL/dz，x 是对应的输入分量。返回 dL/dw = delta * x。"""
    return delta * x
`,
		tests: [
			{
				label: '存活神经元 h1 的 delta 与本关手算值一致',
				code: `d = hidden_delta(5.0, 2.0, 1.7)
assert d > 0, "存活神经元的 delta 不应恒为 0"
assert abs(d - 10.0) < 1e-9, f"delta1 应为 10.0，得到 {d}"`
			},
			{
				label: '死亡神经元 h2 的 delta 恒为 0，即使上游误差不为 0',
				code: `d = hidden_delta(5.0, -1.0, -0.4)
assert d == 0.0, f"z2=-0.4 落在负区间，delta 应为 0，得到 {d}"`
			},
			{
				label: '死亡神经元的权重梯度也恒为 0',
				code: `d2 = hidden_delta(5.0, -1.0, -0.4)
g_w21 = weight_grad(d2, 1.0)
g_w22 = weight_grad(d2, 2.0)
g_b2 = weight_grad(d2, 1.0)  # bias 的“输入”恒为 1
assert g_w21 == 0.0 and g_w22 == 0.0 and g_b2 == 0.0, \\
    f"死亡神经元的全部参数梯度应为 0，得到 w21={g_w21} w22={g_w22} b2={g_b2}"`
			},
			{
				label: '存活神经元 w11 的梯度应为 10.0（本关手算值）',
				code: `d1 = hidden_delta(5.0, 2.0, 1.7)
g_w11 = weight_grad(d1, 1.0)
assert g_w11 > 0, "先确认存活神经元梯度非零"
assert abs(g_w11 - 10.0) < 1e-9, f"w11 梯度应为 10.0，得到 {g_w11}"`
			},
			{
				label: '存活神经元 w12 的梯度应为 20.0（本关手算值）',
				code: `d1 = hidden_delta(5.0, 2.0, 1.7)
g_w12 = weight_grad(d1, 2.0)
assert g_w12 > 0, "先确认存活神经元梯度非零"
assert abs(g_w12 - 20.0) < 1e-9, f"w12 梯度应为 20.0，得到 {g_w12}"`
			},
			{
				label: '上游误差为 0 时，无论神经元死活，delta 都应为 0',
				code: `assert hidden_delta(0.0, 2.0, 1.7) == 0.0, "上游误差为 0 时，存活神经元的 delta 也应为 0"
assert hidden_delta(0.0, -1.0, -0.4) == 0.0, "上游误差为 0 时，死亡神经元的 delta 也应为 0"`
			}
		],
		hint: 'hidden_delta 是三个数相乘：delta_out * v * relu_grad(z)。weight_grad 是两个数相乘：delta * x。',
		explanation:
			'```python\ndef hidden_delta(delta_out, v, z):\n    return delta_out * v * relu_grad(z)\n\n\ndef weight_grad(delta, x):\n    return delta * x\n```\n\n' +
			'这是本关整个数值推导链路的代码版本：`hidden_delta` 对应 δ^(l) 的标量简化形式，' +
			'`weight_grad` 对应 ∂L/∂W^(l) = δ^(l)·(a^(l-1))ᵀ 的标量简化形式。\n\n' +
			'第二条和第三条测试是关键——它们验证的不是"函数写对了没有"，' +
			'而是"死亡 ReLU 在代码里确实会让整条梯度链归零"：即使 `delta_out` 和 `v` 都不是 0，' +
			'只要 `relu_grad(z)` 是 0，最终的权重梯度就必然是 0。'
	}
];
