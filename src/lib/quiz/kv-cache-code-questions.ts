/**
 * KV Cache 代码题。
 *
 * 与数值题的分工：数值题考「能不能算对」，代码题考「能不能写对」。
 * 前者用纸笔就能做，后者必须真的把公式翻译成代码——
 * 这两件事的差距，任何写过代码的人都知道有多大。
 *
 * 全部只用标准库，不加载 numpy：Pyodide 核心已经 10MB，
 * numpy 再加几 MB，而这些题的本质是算术，不需要张量。
 */

import type { CodeQuestion } from './types';

export const KV_CACHE_CODE_QUESTIONS: CodeQuestion[] = [
	{
		kind: 'code',
		id: 'kv-cache-c1-formula',
		prompt:
			'实现 KV Cache 显存计算。\n\n' +
			'公式的每个因子都有来历：最前面的 ×2 是因为 K 和 V 各存一份；' +
			'kv_heads 在 MHA 下等于查询头数，在 GQA 下等于组数。\n\n' +
			'返回**字节数**（整数），不要换算单位。',
		// 起始代码必须抛异常而不是 return 0：
		// 返回 0 会让「A 是 B 的 4 倍」这类比较型断言退化成 0 == 0 * 4 恒真，
		// 用户什么都不写就能通过一半用例。这个缺陷是 solutions.spec.ts 抓出来的。
		starterCode: `def kv_cache_bytes(batch, seq_len, layers, kv_heads, head_dim, dtype_bytes):
    """返回 KV Cache 占用的字节数。"""
    # TODO: 实现这个公式
    raise NotImplementedError("请实现 kv_cache_bytes")
`,
		solutionCode: `def kv_cache_bytes(batch, seq_len, layers, kv_heads, head_dim, dtype_bytes):
    """返回 KV Cache 占用的字节数。"""
    return 2 * batch * seq_len * layers * kv_heads * head_dim * dtype_bytes
`,
		tests: [
			{
				label: 'Llama 3 8B, GQA 8 组, batch=1, seq=8192, fp16 → 恰好 1 GiB',
				code: `assert kv_cache_bytes(1, 8192, 32, 8, 128, 2) == 1073741824, \\
    f"应为 1073741824 字节（1 GiB），得到 {kv_cache_bytes(1, 8192, 32, 8, 128, 2)}"`
			},
			{
				label: '同配置改 MHA（32 个 KV 头）→ 正好 4 倍',
				code: `mha = kv_cache_bytes(1, 8192, 32, 32, 128, 2)
gqa = kv_cache_bytes(1, 8192, 32, 8, 128, 2)
assert gqa > 0, "先让基本计算返回非零值"
assert mha == gqa * 4, f"MHA 应是 GQA 的 4 倍，实际比值 {mha / gqa}"`
			},
			{
				label: 'Llama 2 70B 生产配置 → 40 GiB',
				code: `got = kv_cache_bytes(32, 4096, 80, 8, 128, 2) / 1024 ** 3
assert abs(got - 40.0) < 1e-9, f"应为 40.0 GiB，得到 {got}"`
			},
			{
				label: 'int8 量化后正好减半',
				code: `fp16 = kv_cache_bytes(32, 4096, 80, 8, 128, 2)
int8 = kv_cache_bytes(32, 4096, 80, 8, 128, 1)
assert int8 > 0, "先让基本计算返回非零值"
assert int8 * 2 == fp16, "精度减半后字节数应减半"`
			},
			{
				label: '对 batch 与 seq_len 都是线性关系',
				code: `base = kv_cache_bytes(1, 1024, 4, 2, 64, 2)
assert base > 0, "先让基本计算返回非零值"
assert kv_cache_bytes(3, 1024, 4, 2, 64, 2) == base * 3, "对 batch 应线性"
assert kv_cache_bytes(1, 3072, 4, 2, 64, 2) == base * 3, "对 seq_len 应线性"`
			}
		],
		hint: '六个因子全部相乘，再乘以最前面的 2。注意不要漏掉 dtype_bytes。',
		explanation:
			'```python\nreturn 2 * batch * seq_len * layers * kv_heads * head_dim * dtype_bytes\n```\n\n' +
			'这个函数是容量规划的全部基础。记住它之后，' +
			'「这个模型这个并发要几张卡」就是一道算术题——' +
			'先算权重占用，再用这个函数算 KV Cache，两者相加再留出激活值余量。'
	},
	{
		kind: 'code',
		id: 'kv-cache-c2-max-batch',
		prompt:
			'实现容量规划：给定显卡显存和模型配置，算出**最大并发数**。\n\n' +
			'显存分三块：模型权重（固定）、KV Cache（随 batch 线性增长）、' +
			'激活值与运行时开销（用 reserve_gib 表示）。\n\n' +
			'返回能同时服务的最大请求数（整数，向下取整）。放不下一个请求时返回 0。',
		setupCode: `GIB = 1024 ** 3

def kv_cache_bytes(batch, seq_len, layers, kv_heads, head_dim, dtype_bytes):
    return 2 * batch * seq_len * layers * kv_heads * head_dim * dtype_bytes
`,
		starterCode: `def max_batch(gpu_gib, weight_gib, reserve_gib, seq_len, layers, kv_heads, head_dim, dtype_bytes):
    """返回该显卡在给定配置下能服务的最大并发请求数。

    已提供 kv_cache_bytes() 和常量 GIB。
    """
    # TODO: 先算出留给 KV Cache 的空间，再除以单个请求的占用
    raise NotImplementedError("请实现 max_batch")
`,
		solutionCode: `def max_batch(gpu_gib, weight_gib, reserve_gib, seq_len, layers, kv_heads, head_dim, dtype_bytes):
    available_gib = gpu_gib - weight_gib - reserve_gib
    if available_gib <= 0:
        return 0
    per_request_gib = kv_cache_bytes(1, seq_len, layers, kv_heads, head_dim, dtype_bytes) / GIB
    return int(available_gib // per_request_gib)
`,
		tests: [
			{
				label: '80GB A100 跑 Llama 3 8B（权重 14.9，预留 8）→ 57 并发',
				code: `got = max_batch(80, 14.9, 8, 8192, 32, 8, 128, 2)
assert got == 57, f"应为 57，得到 {got}"`
			},
			{
				label: '预留翻倍后并发相应减少',
				code: `a = max_batch(80, 14.9, 8, 8192, 32, 8, 128, 2)
b = max_batch(80, 14.9, 16, 8192, 32, 8, 128, 2)
assert b < a, "预留更多显存后并发数应下降"
assert b == 49, f"应为 49，得到 {b}"`
			},
			{
				label: '上下文翻倍则并发减半',
				code: `short = max_batch(80, 14.9, 8, 4096, 32, 8, 128, 2)
long = max_batch(80, 14.9, 8, 8192, 32, 8, 128, 2)
assert long > 0, "先让基本计算返回非零值"
assert short == long * 2, f"seq_len 翻倍并发应减半，得到 {short} 与 {long}"`
			},
			{
				label: '权重就装不下时返回 0，不能返回负数',
				code: `got = max_batch(24, 130.4, 8, 4096, 80, 8, 128, 2)
assert got == 0, f"装不下应返回 0，得到 {got}"`
			},
			{
				label: '刚好只够权重和预留时返回 0',
				code: `got = max_batch(23, 15, 8, 8192, 32, 8, 128, 2)
assert got == 0, f"没有余量应返回 0，得到 {got}"`
			}
		],
		hint: '可用显存 = 显卡 − 权重 − 预留。注意先检查它是否 ≤ 0，否则会算出负数并发。',
		explanation:
			'```python\navailable_gib = gpu_gib - weight_gib - reserve_gib\nif available_gib <= 0:\n    return 0\nper_request_gib = kv_cache_bytes(1, seq_len, ...) / GIB\nreturn int(available_gib // per_request_gib)\n```\n\n' +
			'边界检查不是形式主义。真实的容量规划服务里，' +
			'如果这里返回负数并被当作配额传下去，' +
			'调度器会认为「还能接请求」，然后在实际分配显存时 OOM 崩掉整个实例。\n\n' +
			'这道题的另一个收获是「上下文翻倍则并发减半」——' +
			'长上下文的成本不是线性可选的功能，它直接吃掉一半吞吐。'
	}
];
