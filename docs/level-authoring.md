# 写一个新关卡

先读 [AGENTS.md](../AGENTS.md)。这份文档只讲内容怎么写。

---

## 一个关卡由什么组成

**五个文件，缺任何一个关卡都不完整。** 特别注意第 5 项——漏了它，关卡能直连访问
但首页进不去，看起来像没做完。

| #   | 文件                                        | 作用                    | 必需     |
| --- | ------------------------------------------- | ----------------------- | -------- |
| 1   | `src/lib/quiz/<level-id>-questions.ts`      | 题库，8–12 道可判定题   | ✅       |
| 2   | `src/lib/quiz/<level-id>-questions.spec.ts` | 共享校验 + 数值独立重算 | ✅       |
| 3   | `src/lib/components/<Name>Sandbox.svelte`   | 沙盒                    | 有权衡时 |
| 4   | `src/routes/<level-id>/+page.svelte`        | 关卡页面                | ✅       |
| 5   | **`src/routes/+page.svelte`（改首页）**     | **加入口卡片**          | ✅       |

### 第 4 步：页面不要从零写

`src/routes/kv-cache/+page.svelte` 约 300 行，含一整套状态管理。**复制它改**，
需要替换的只有：题库 import、沙盒组件、`<Seo>` 的三个参数、页头文案。

**不要改的部分**（已验证的状态管理，改了容易出 bug）：`onMount` 里的
`progress.load()` + `buildDueDeck`、`{#key current.id}`、`handleResolved`、
`restartRound`、掌握度统计渲染。

### 第 5 步：接入首页

首页有一张 `.card-soon` 占位卡片，代表后续规划——**不要动它**，新增一张
`<a class="card">`：

```svelte
<script>
	import { resolve } from '$app/paths';
	import { YOUR_QUESTIONS } from '$lib/quiz/your-level-questions';
	import { summarizeMastery } from '$lib/quiz/schedule';

	const yourIds = YOUR_QUESTIONS.map((q) => q.id);
	const yourMastery = $derived(summarizeMastery(yourIds, progress.scheduleView));
</script>

<!-- href 必须用 resolve()，见 AGENTS.md 硬约定 #2 -->
<a class="card" href={resolve('/your-level')}>
	<div class="card-top">
		<span class="tag">模块名</span>
		{#if ready && yourMastery.mastered === yourMastery.total}
			<span class="badge badge-done">已通关</span>
		{/if}
	</div>
	<h3>关卡标题</h3>
	<p>一句话说清这关能学到什么能力</p>
	<span class="cta">开始 →</span>
</a>
```

### OG 图

在 `scripts/generate-og.mjs` 的 `PAGES` 数组加一项，跑 `pnpm run og`，
然后把文件名填进关卡页的 `<Seo ogImage="...">`。

---

## 第一原则：题目必须能被程序判定

当前**只有两种**判定方式，`src/lib/quiz/types.ts` 的 `Question` 就是这两者的联合类型：

| 类型      | 判定方式           | 适合考什么         |
| --------- | ------------------ | ------------------ |
| `numeric` | 数值比较（带容差） | 计算能力、量级直觉 |
| `choice`  | 选项匹配           | 概念辨析、方案选择 |

> ⚠️ **不要自己新增题型。** 浏览器内跑 Python 断言的代码题（`kind: 'code'`）在规划中，
> 但**尚未实现**——`types.ts` 里没有这个分支，`judge.ts` 也不认它。
> 如果你手头的内容只能用代码题表达，**停下来找维护者确认**。
> 新题型要同时改判定引擎、UI 组件、校验器和进度存储，是跨模块设计决策，不是内容工作。

**不收录的题**：

```
❌ 谈谈你对 KV Cache 的理解
❌ 比较 GQA 和 MQA 的优劣
❌ 什么情况下应该用 PagedAttention
```

这些无法判定。改造方法是**把它变成有确定答案的**：

```
✅ 32 个查询头分 8 组，KV Cache 相比 MHA 节省几倍？        → 4
✅ MQA 相比 GQA 最主要的代价是什么？（四选一）              → 质量下降更明显
✅ PagedAttention 主要解决哪个问题？（四选一）              → 显存碎片与浪费
```

---

## 数值题

```ts
{
  kind: 'numeric',
  id: 'kv-01-gqa-baseline',        // 全局唯一，前缀是关卡 id
  prompt:
    'Llama 3 8B：32 层，32 个查询头，head_dim = 128，GQA 分 8 组。\n' +
    'batch = 1，seq_len = 8192，fp16。\n\n' +
    'KV Cache 占多少 GB？',
  answer: 1,
  unit: 'GB',
  tolerance: 0.05,                 // 绝对容差
  hint: '别忘了 K 和 V 各存一份，公式最前面有个 ×2。',
  explanation:
    '2 × 1 × 8192 × 32 × 8 × 128 × 2 bytes = 1,073,741,824 bytes = 恰好 1.00 GB\n\n' +
    '把这个数字记住：**8B 模型在 8K 上下文下，每个并发请求约吃 1 GB**。'
}
```

### 容差怎么定

| 题目性质                     | 建议                                        |
| ---------------------------- | ------------------------------------------- |
| 整数结果（倍数、组数、层数） | 不设容差，必须精确                          |
| 显存、成本这类连续量         | `tolerance` 取答案的 1–3%                   |
| 需要多步估算的（如临界点）   | `tolerance: 1` 或 `relativeTolerance: 0.05` |

判定引擎已经容忍输入格式：单位后缀、全角数字、千分位逗号、科学计数法、前导「约」。
**不要为了迁就输入格式而放大容差。**

### 题干写法

- 参数分行列出，比堆在一句话里可读得多（`prompt` 的换行会被保留）
- 一道题只考一个点。要考两步就拆成两道，第二道用「承上题」
- 给出所有必需参数，不要让用户去猜

### explanation 是关卡的真正价值

不是只写答案，要写**推导 + 为什么重要**：

```
2 × 32 × 4096 × 80 × 8 × 128 × 2 bytes = 40.0 GB

同样配置若用 MHA（64 个 KV 头）会是 320 GB —— 4 张 80GB A100
全部用来放缓存都不够。GQA 不是优化，是让 70B 能在合理成本下被服务的前提条件。
```

第二段那种「所以呢」才是读者记得住的东西。

---

## 选择题

```ts
{
  kind: 'choice',
  id: 'kv-04-mqa-tradeoff',
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
    3: 'MQA 和 GQA 都可以从已有 MHA 模型做 uptraining 转换，不需要从零预训练。'
  },
  explanation: '...'
}
```

### 干扰项必须是真实误解

**这是选择题质量的全部。** 凑数的干扰项会让题目变成阅读理解。

好的干扰项来源：

- 方向搞反（以为 MQA 更费显存）
- 混淆相邻概念（把 PagedAttention 当成压缩技术）
- 过时的认知（以为必须重新预训练）
- 似是而非的直觉（以为激活值随 batch 平方增长）

`distractorNotes` 给每个错误选项写定向解释——用户选错时看到的是针对**他那个具体误解**的说明，而不是通用答案。这比「答案是 B」有用得多。

`distractorNotes` 的键不能包含 `answerIndex`，测试会检查。

---

## 沙盒

沙盒的价值在于**让用户体验真实的权衡**，不是展示计算器。

### 设计要求

**必须有两个以上互相冲突的约束。** 只有一个约束的沙盒毫无意义——用户一路选最优就通关，什么也学不到。

### 如果这个主题找不到两个天然冲突的约束

有些主题确实没有 KV Cache 那种「显存 vs 质量」的天然权衡，比如
「Tokenizer 切分」「Attention 因果掩码」更偏机制展示而非决策取舍。
**不要为了凑数编造假约束**，那比没有沙盒更糟。三条退路，按优先级：

1. **改成「观察型交互」而不是「达标型沙盒」。** 用户调参数，看现象变化，
   配合「预测再验证」——先让用户猜结果，再显示真实值。
   `AttentionDemo` 这类就属于这种：切换因果掩码看注意力矩阵怎么变。
   这种交互没有「通关」概念，页面上不要显示达标判定。

2. **把成本或性能维度引进来构造真实约束。** 比如 Tokenizer 可以做
   「同一段中文，不同分词器的 token 数 → 直接换算成 API 成本」——
   压缩率和词表大小、OOV 率之间有真实权衡。

3. **这一关就不做沙盒，只做题库。** 完全可以接受。
   `docs` 里「沙盒」一栏写的是「有权衡时必需」，不是无条件必需。

判断标准很简单：**如果你需要编造数字才能构造出第二个约束，就走退路 1 或 3。**

KV Cache 关卡的设计可以参考：

```
约束 1：KV Cache < 45 GB       ← 压低显存
约束 2：质量损失 < 2%           ← 但不能压太狠

12 个配置组合，恰好 3 个达标：
  显存超标 5 个（含 1 个双超）
  质量超标 5 个
  达标 3 个
```

关键是 **MQA 显存最省却过不了质量约束**——用户无法靠「每次选最省的」通关。

### 设计沙盒时先用脚本枚举

写组件之前，先写个脚本把所有配置组合的结果算出来，确认：

- 至少有 1 个可行解（否则关卡无解）
- 不是超过一半都可行（否则太容易）
- 失败原因分布在不同约束上（否则退化成单约束）
- 「一路选最省」必须失败

把这个枚举结果贴进 commit message 或测试注释里，**然后删掉脚本**——
`AGENTS.md` 禁止提交临时脚本。如果这个枚举有长期价值（比如需要随参数调整重跑），
那就把它写成正式测试放进 `*-questions.spec.ts`，而不是留一个游离脚本。

### 编造数字的红线

显存、参数量、FLOPs 这类**可精确计算的必须算准**。

质量损失、加速比这类**依赖具体模型和任务的，只能标为示意性估算**：

```svelte
<p class="disclaimer">
	显存数值是精确计算。质量损失是<b>示意性估算</b>，用于体现权衡的量级关系，
	不代表某次具体评测结果——真实损失取决于模型、任务和校准数据。
</p>
```

**宁可标注为估算，也不要假装精确。** 内行一眼看穿，信誉一次就没了。

---

## 测试要求

每个关卡的 `*-questions.spec.ts` 至少覆盖：

```ts
describe('题库结构完整性', () => {
	it('id 全局唯一');
	it('每道题都有非空题干和解释');
	it('选择题的正确答案下标在选项范围内');
	it('选择题的干扰项说明不指向正确答案');
	it('数值题的容差非负');
	it('每道题的正确答案都能通过判定引擎'); // 防止容差设成 0 却给了小数答案
});

describe('题目数值与公式一致', () => {
	// 用独立实现的公式重算每道题，不是复制题目里的数字
	it('kv-01：8B GQA batch=1 seq=8192 fp16 应为 1 GB');
	// ...
});
```

**「用独立公式重算」的含义**：在测试里写一遍公式函数，用它算，然后和题目的 `answer` 比。
不是 `expect(q.answer).toBe(1)`——那只是复述，抓不到错。

---

## 关卡自检清单

- [ ] 8–12 道题，类型有搭配（不要全是数值题）
- [ ] 每道题只考一个点
- [ ] 所有数值有独立重算测试
- [ ] 每个干扰项都是真实误解，且有 `distractorNotes`
- [ ] explanation 有推导 + 「所以呢」
- [ ] 沙盒有 ≥2 个冲突约束，且「一路选最省」会失败
- [ ] 沙盒的可行解数量已用脚本枚举确认
- [ ] 无法精确计算的数字标注了「示意性估算」
- [ ] 题目 id 前缀与关卡 id 一致
- [ ] `pnpm run check:all` 与 `pnpm run test:smoke` 全绿

---

## 参考实现

- 题库：`src/lib/quiz/kv-cache-questions.ts`
- 题库测试：`src/lib/quiz/kv-cache-questions.spec.ts`
- 沙盒：`src/lib/components/KvCacheSandbox.svelte`
- 沙盒测试：`src/lib/components/KvCacheSandbox.svelte.spec.ts`（注意 `.svelte.spec.ts` 后缀）
- 题库校验器：`src/lib/quiz/validate.ts`
- 页面：`src/routes/kv-cache/+page.svelte`

内容素材来自 `~/PycharmProjects/tech-learning-and-projects/learning-notes/00-ai/`。
**读实际章节内容，不要靠关键词猜测笔记里有什么**——这个错误犯过，代价是整轮判断作废。
