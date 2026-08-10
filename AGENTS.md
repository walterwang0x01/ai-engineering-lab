# AGENTS.md

**任何 agent 在本仓库做任何改动之前，先完整读这个文件。**

这里记录的每一条都来自真实踩过的坑。不读就动手，会把已经修过的问题重犯一遍。

---

## 项目是什么

交互式 AI 工程练习场。核心约束一句话：

> **每道题都必须能被程序判定对错。**

开放式问题（「说明 X 是怎么工作的」）无法判定，只能自评；自评没有即时反馈，而且人会系统性高估自己。所以本项目不收录无法判定的题目——这条约束不可协商，它是产品的立足点。

纯静态站，无后端，学习进度存在浏览器 localStorage。

---

## 硬约定（违反会出问题，不是风格偏好）

### 1. 根 `+layout.ts` 的 `prerender = true` 不能删

`adapter-static` 要求全站预渲染。删掉构建直接失败。

```ts
// src/routes/+layout.ts
export const prerender = true;
export const trailingSlash = 'never';
```

### 2. 内部链接必须用 `resolve()`

```svelte
<script>
	import { resolve } from '$app/paths';
</script>

<!-- ✅ -->
<a href={resolve('/kv-cache')}>关卡</a>

<!-- ❌ ESLint 会报 svelte/no-navigation-without-resolve -->
<a href="/kv-cache">关卡</a>
```

站点部署在 `walterwang0x01.github.io/ai-engineering-lab/` 子路径下，硬编码路径会断链。

**子路径部署必须设 `BASE_PATH`。** 这条曾经写反过，代价是 168 篇笔记的直连全白屏：

- 预渲染页（`index.html` / `notes.html` / `kv-cache.html`）用相对路径 `./_app/…`，
  放在任何前缀下都对——所以「不配 base 也行」的结论在这些页面上成立。
- 但 **SPA fallback（`404.html`）不一样**：它会被 GitHub Pages 从任意深度返回，
  相对路径在 `/notes/a/b` 这种深度下会解析错，所以 SvelteKit 给它发**根绝对路径**
  `/_app/…`。`base` 为空时那指向域名根，站点在子路径下 → fallback 页一个 JS 都加载不到
  → 客户端路由永不启动 → 深层路由白屏。

症状极具误导性：首页、`/notes`、关卡页全部正常，只有未预渲染的深层 URL 坏掉，
看起来像「路由坏了」，实际是资源前缀错了。而且**本地冒烟测试结构上抓不到**——
`vite preview` 服务在域名根上，根绝对路径永远解析正确。

门禁是 `scripts/assert-fallback-base.mjs`，跑在每次 `build` 之后，校验
fallback 的资源前缀与 `BASE_PATH` 一致。CI 额外做一次子路径构建来覆盖这个组合。
`BASE_PATH` 漏写斜杠会在构建时报错，不会悄悄退化。

### 3. `QuizCard` 不自我重置，调用方必须用 `{#key}`

组件刻意不监听 `question` 变化做重置——整体重建不留状态残留的余地。

```svelte
<!-- ✅ -->
{#key current.id}
	<QuizCard question={current} onResolved={handle} onNext={next} />
{/key}

<!-- ❌ 换题后会残留上一题的输入、判定结果、错误次数 -->
<QuizCard question={current} onResolved={handle} onNext={next} />
```

### 4. 表单交互用 `<form onsubmit>`，不要在容器上挂 `keydown`

`QuizCard` 的容器是 `<form>`。这样 Enter 键天然可用，也不会触发
`a11y_no_noninteractive_element_interactions` 警告。所有按钮是 `type="submit"`，
由 `onsubmit` 按状态分派（提交 / 再试一次 / 下一题）。

不要改回 `<article onkeydown={...}>`。

### 5. 组件测试选择器：数值一律用 `data-testid`

同一个数值常同时出现在仪表盘和公式推导里，`getByText('320 GB')` 会命中多个元素，
Playwright 严格模式直接报 `strict mode violation`。

```ts
// ✅
expect(screen.getByTestId('memory-value').element().textContent).toBe('320 GB');

// ❌ 命中多个
await expect.element(screen.getByText('320 GB')).toBeInTheDocument();

// 文本类断言若可能有子串冲突，用 exact
screen.getByText('倍', { exact: true }); // 题干里的「几倍」不会误命中
```

### 6. 测试文件名决定跑在哪个环境，放错会静默不跑

`vite.config.ts` 用文件名 glob 把测试分派到两个 project：

| 文件名             | 跑在哪        | 用于                                   |
| ------------------ | ------------- | -------------------------------------- |
| `*.spec.ts`        | Node          | 纯逻辑：判定、调度、题库校验、数值重算 |
| `*.svelte.spec.ts` | 真实 Chromium | 组件渲染与交互                         |

**放错的后果是静默的**：把组件测试命名成 `*.spec.ts` 会在 Node 里跑，
没有 DOM 直接报错；反过来把纯逻辑测试命名成 `*.svelte.spec.ts` 会白等浏览器启动。
更糟的情况是名字不匹配任何 glob，**测试根本不会被执行，而 CI 显示绿色**。

注意 `progress.svelte.ts` 的测试叫 `progress.spec.ts`（不带 `.svelte`）——
它测的是 runes 状态逻辑，不需要 DOM，跑在 Node 里。**runes 在 Node 环境可以正常工作。**

### 7. e2e 必须等 hydration，不能只等 `waitForURL`

SvelteKit 客户端路由是异步的。`waitForURL` 返回时 JS 可能还没接管，
点击会打在静态 HTML 上——症状是「点了按钮但数值不变」，极难排查。

```js
await page.waitForURL('**/kv-cache');
// 必须再等一个只有 onMount 之后才出现的元素
await page.waitForSelector('.counter');
```

### 8. e2e 服务器直接 spawn `vite`，不要 `pnpm run preview`

多一层 pnpm 包装会导致 `kill` 杀不掉真正的 vite 子进程。残留进程占着端口，
下次运行连到的是**旧服务器**，而 build 目录正在被重写——症状极其诡异。

```js
spawn('node_modules/.bin/vite', ['preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
```

`--strictPort` 必须加：否则端口被占时 vite 悄悄换端口，测试连到别处。
运行前还要 `assertPortFree()`，退出时等 `exit` 事件确认进程真的死了。

### 9. `og:image` 必须是绝对 URL 且为 PNG

相对路径和 SVG 会被社交平台抓取器静默拒绝。站点根地址硬编码在
`src/lib/components/Seo.svelte` 的 `SITE` 常量里。

改站点域名时要同步改：`Seo.svelte`、`scripts/generate-og.mjs`、README、CI。

### 10. 题目 id 必须以关卡 id 为前缀

进度存储是**全站单例、单一命名空间**（`storage/progress.svelte.ts` 的 `records`）。
两个关卡各起一个 `01-baseline`，间隔重复状态会互相覆盖——
而这个 bug 在按文件隔离跑的单元测试里看不出来，只在用户练完两关后才暴露。

所以这条不靠自觉，是门禁：每个题库的 spec 必须调用

```ts
assertValidQuestionSet(YOUR_QUESTIONS, 'your-level-id');
```

`src/lib/quiz/validate.ts` 会检查 id 前缀、唯一性、选项合法性、
以及标准答案能否通过判定引擎。新增题库照抄这一行即可获得全部校验。

### 11. 代码题的判定是异步的，不能走 `judge()`

`judge()` 只处理 `numeric` 和 `choice`，遇到 `code` 会抛错。这是故意的：
静默返回错误结果会让界面显示「答错了」，掩盖掉真正的问题（分派用错了）。

界面层按 `question.kind` 分派：

```svelte
{#if current.kind === 'code'}
	<CodeQuestionCard question={current} … />
{:else}
	<QuizCard question={current} … />
{/if}
```

`QuizCard` 的 Props 类型是 `SyncQuestion`（`NumericQuestion | ChoiceQuestion`），
传代码题进去会**编译期报错**而不是运行时才发现。

### 12. Pyodide 必须严格懒加载

Pyodide 核心约 10MB。只在用户点「运行」时才创建 Worker，
阅读路径完全不碰。已验证：CodeMirror 的 297KB 在独立 chunk 里，
首页和关卡页都不加载它。

**不要在页面加载时调用 `runner.warmup()`** ——
那等于把 10MB 强加给只想读题的人。

### 13. 死循环只能靠 terminate Worker 中断

Pyodide 执行 Python 是同步阻塞的，Worker 内部收不到消息，
`while True` 无法从内部打断。唯一手段是主线程 `worker.terminate()`，
代价是下次运行要重新加载 Pyodide。这个代价必须告知用户，不能静默发生。

超时预算在 `src/lib/python/runner.ts`：首次运行 75 秒（含加载），之后 15 秒。

### 14. OG 模板的 flex 子项必须 `flex-shrink: 0` + `white-space: nowrap`

否则中文被压缩换行：「可判定」变「可判/定」、「320 GB」变「320/GB」。

`scripts/generate-og.mjs` 里已有程序化溢出检测（`scrollWidth > clientWidth` 就报错退出）。
**不要删掉那段检测**——目测很容易漏掉换行。

### 15. 首页与导航必须从 curriculum 派生，不要手写

`src/lib/curriculum/` 是学习路径的**唯一数据源**：它把 `levels/registry.ts` 的关卡
和 `static/notes/manifest.json` 的 168 篇笔记 join 成模块 → 章节 → 篇目的结构。

背景：`/notes` 和 168 篇笔记曾经是**孤儿页面**——部署好了、返回 200，
但站内没有任何链接指向它，只能手输 URL 才能进去。根 `+layout.svelte` 当时是个没有
导航的空壳，首页只渲染 registry 的关卡卡片。这与阶段 0 审计抓到的「关卡能直连访问但
首页进不去」是同一个缺陷，只是换了个位置又发生了一遍。

**`Curriculum.orphanLevels` 必须渲染。** 笔记未同步时 `modules` 是空的，
不单独渲染这一段会让 5 个关卡从首页整体消失——把孤儿缺陷反向复制一遍。
组件测试 `LearningPath.svelte.spec.ts` 有一条专门守这个。

关卡 ↔ 笔记的映射在 `curriculum/mapping.ts`，**人工维护**。不要改成按标题自动匹配：
一关的背景常横跨多篇（backprop 同时依赖《反向传播推导》和《激活函数》），
自动匹配会产出看似合理但错误的关联，而错误关联比没有关联更糟。

### 16. 冒烟测试用 `a.card` 计数关卡，别拿 `card` 类给别的东西

`e2e/smoke.mjs` 断言「首页 `a.card` 数量 === 预渲染的关卡页数量」。
给笔记模块之类的元素套 `card` 类会污染这条断言，而且症状是「新增关卡后测试莫名失败」。

### 17. Tier A 笔记题只能是选择题，且必须显式过审

笔记里的可判定题走 `scripts/lib/extract-quiz.mjs`，来源有两处（同一套 schema、同一道校验）：

- 笔记正文里的 ` ```ael-quiz ` 围栏块（JSON 数组）
- 本仓库的 `content/note-questions/<slug>.json`

三条不可协商的规则：

1. **只允许 `choice`。** 数值题必须写在关卡题库里——第 10 条的独立重算门禁是人工领域
   工作，抽取管道代替不了。管道遇到 `kind: "numeric"` 直接报错。
2. **`reviewed` 必须显式为 `true` 才进产物。** 缺字段是错误，不默认放行。
   LLM 起草的题一律先 `false`，人工逐题过审后翻转。未过审内容在物理上到不了线上。
3. **id 带 `note:` 前缀**（`note:<slug>-<局部id>`）。进度存储是全站单一命名空间，
   这个前缀是笔记题与关卡题不撞车的保障，由 `assertValidQuestionSet` 校验。

抽取出任何结构问题**让构建失败**，不静默跳过——否则作者以为题上线了，实际被丢掉了。

### 18. 达标型沙盒的仪表与选项组用共享组件

`ConstraintGauge.svelte`、`OptionChips.svelte`、`lib/sandbox/constraints.ts`。

`levels/types.ts` 里「交互组件不抽象」的判断依然成立——那是针对**跨类别**的。
但达标型（多约束调参）现在有三个同构样本，仪表盘 CSS 逐条比对后完全相同，
24 条规则重复了三遍。抽的是这一个具体形状里可证明重复的部分，公式、阈值、文案
仍留在各自沙盒里。观察型的 `AttentionHeatmap` / `BackpropExplorer` 不要往这上面套。

改这两个共享组件时，**`KvCacheSandbox.svelte.spec.ts` 的断言一字不改仍须全绿**——
那 17 条断言就是行为等价性的证明。

### 19. `test:unit` 在 CI 里需要 `REQUIRE_NOTES=1`

curriculum 的映射一致性门禁要校验 slug 在 manifest 里真实存在，
而 `test:unit` 不触发 `assets:sync`，manifest 不会自己出现。

本地没有笔记源仓库时那批断言按 `it.skipIf` 跳过（vitest 会显示 skipped，不是 passed）；
CI 里 `REQUIRE_NOTES=1` 让 manifest 缺失或为空**直接失败**。
CI 因此多了一步显式的 `pnpm run notes:sync`。删掉任何一环都会退回「CI 绿了却没校验」。

---

### 20. 颜色只能写在 `layout.css`，两套主题必须成对维护

`src/routes/layout.css` 是**唯一**能出现颜色取值的地方。`@theme` 里是浅色（默认），
文件末尾 `prefers-color-scheme: dark` 里逐项覆盖成深色。组件只引用 token。

这条不靠自觉，`src/lib/design/palette.spec.ts` 守三件事：

1. **`layout.css` 之外零颜色字面量。** 包括 JS 里拼出来的——热力图的色阶曾经写成
   `` `oklch(${0.32 + t * 0.42} …)` ``，而只匹配「`oklch(` 后紧跟数字」的正则**正好躲过去**，
   让它在门禁下藏了一整轮。现在两种形式都数。
   注释里的历史取值不算违规（先剥注释）：那是取值背后的原因，删掉解释是本末倒置。
2. **两套主题各自达标。** 文字与语义色对各自的 `--color-surface` ≥4.5:1；
   `--color-accent-dim` 只用于状态边框，按 WCAG 1.4.11 的 3:1 算。
3. **深色必须覆盖每一个与主题相关的 token。** 漏一个的后果不是「不好看」而是看不见——
   `--color-text-strong` 漏了就是近黑压在深色底上。刻意两套一致的（热力图那四个）
   写进 `THEME_INVARIANT` 并说明理由。

背景：收敛前有 113 处 `oklch()` 字面量散在 17 个文件里，L=0.55–0.84 之间挤着 8 个
几乎无法分辨的灰。真正的代价不是「换主题很麻烦」，而是**三处灰用在 11–14px 小字上、
对比度 4.19:1 不达标，躺了很久没人发现**——因为没有任何一个地方能一眼看全所有取值。

写新档位前先想清楚：`--color-text-dim` 那一档就是这么来的，也因此被删掉了。
相邻灰阶至少差 0.04 明度，肉眼分不出来的层级等于没有层级。

对比度在 Node 里用 OKLab 矩阵算，不启动浏览器；有一条把结果钉在 canvas 实测值上，
防止矩阵被改坏之后所有断言静默失真。

### 21. 吉祥物是「不要卡通游戏风」的唯一例外

`src/lib/components/Mascot.svelte`。它的身体**就是 ReLU 折线**：存活时上扬、
头部（输出端）抬起并发光，死亡时整条压平、头跌回基线。这正是第一关要教的那件事，
所以它在 `BackpropExplorer` 里跟着 `alive2` 走，是内容的一部分，不是贴上去的插画。

例外的边界靠三件事守住，改它的时候别越界：

- **单色**。所有结构线条用 `currentColor`，由调用方的 `color` 决定，
  因此天然跟随主题，也不引入第二套配色。
- **默认不动**。没有自发动画。
- **面部只有点和短线**。没有渐变、高光这类插画语言。

第一版把胞体放在折线拐点正上方，结果胞体把水平段整段盖住——存活态读不出「折线」，
死亡态看着像个带胡须的禁止标志。头放在上扬笔画的末端才能让折线全程可见。

不传 `label` 时它是装饰（`aria-hidden`）。`BackpropExplorer` 里刻意不传：
旁边那段文字已经把状态说全了，再给图形一个名字会让读屏把「已死亡」听两遍。

---

## 目录职责

```
src/lib/levels/        关卡定义层
  types.ts             LevelDefinition 契约
  registry.ts          ★ 全站唯一关卡数据源。路由、首页卡片、预渲染路径都从这里派生
  registry.spec.ts     结构门禁，新增关卡自动覆盖

src/lib/curriculum/    学习路径层。关卡与 168 篇笔记的唯一交汇点
  types.ts             Curriculum / CurriculumModule 契约（含 orphanLevels）
  mapping.ts           ★ 关卡 ↔ 背景笔记映射，人工维护
  build.ts             buildCurriculum(manifest)：registry + manifest → 学习路径
  progress.ts          统一进度视图。可判定信号优先于「已读」这个自评信号
  curriculum.spec.ts   映射门禁（结构恒跑，slug 一致性需 manifest）
  progress.spec.ts     两套进度冲突态的裁决

src/lib/design/       设计系统的门禁（无运行时代码）
  palette.spec.ts      颜色收敛 + 两套主题的对比度与完整性校验（见第 20 条）

src/lib/sandbox/       达标型沙盒的共享纯逻辑
  constraints.ts       barPct / allSatisfied / SolvedLatch

src/lib/quiz/          判定与调度的纯逻辑，不含 UI
  types.ts             题目与判定结果的类型契约
  judge.ts             判定引擎（数值容差、选择题）
  schedule.ts          Leitner 间隔重复（纯函数，不碰存储）
  validate.ts          题库校验（id 命名空间、结构、答案自洽）
  *-questions.ts       题库数据。每个关卡一个文件

src/lib/python/        浏览器内 Python 执行
  messages.ts          Worker 通信协议 + Pyodide CDN 版本
  harness.ts           执行内核。Worker 和单元测试共享，避免两份实现漂移
  worker.ts            Worker 入口
  runner.ts            主线程客户端。懒加载、超时熔断、Worker 重建
  solutions.spec.ts    用真实 Pyodide 验证代码题自洽（Node 下走本地 WASM）

src/lib/storage/       持久化
  backend.ts           StorageBackend 接口 + localStorage / 内存两种实现
  progress.svelte.ts   题目进度（Leitner）。文件名必须以 .svelte.ts 结尾才能用 runes
  notes-progress.svelte.ts  笔记已读集合。与题目进度**刻意不共享存储**

src/lib/components/    UI 组件
  LearningPath.svelte  首页学习路径。模块骨架 + 关卡卡片 + orphanLevels
  Mascot.svelte        吉祥物。身体是 ReLU 折线，跟着存活状态走（见第 21 条）
  ConstraintGauge.svelte / OptionChips.svelte  达标型沙盒共享件（见第 18 条）

content/note-questions/  本仓库维护的 Tier A 题库，路径镜像笔记 slug

scripts/
  sync-notes.mjs         构建期同步笔记 + 抽取 Tier A 题目
  lib/extract-quiz.mjs   Tier A 抽取与校验。被构建脚本和单测共用
  generate-og.mjs        OG 图生成（手动跑，不进构建）

src/routes/            页面
  +layout.svelte       全站外壳。★ 导航在这里，不要让页面各自写
  +page.svelte         首页。从 curriculum 派生，不要手写关卡卡片
  [levelId]/           ★ 所有关卡共用这一个页面实现，不要为新关卡建目录
  notes/               笔记库列表页与阅读页（阅读页含 Tier A 题卡）
  layout.css           设计系统。浅色在 @theme，深色在 prefers-color-scheme 里覆盖
e2e/smoke.mjs          全链路冒烟测试，自管服务器生命周期
```

---

## 质量门禁

**任何改动提交前必须四条全绿，没有例外。**

```bash
pnpm run lint          # prettier --check + eslint，必须 0 问题
pnpm run check         # svelte-check，必须 0 错误 0 警告
pnpm run test:unit     # 单元 + 组件测试
pnpm run test:smoke    # 构建 + 真实浏览器全链路
```

一条命令跑全部：

```bash
pnpm run check:all
```

组件测试需要 Chromium：`pnpm exec playwright install chromium`

### 数值内容的额外硬门禁

**新增任何数值题，必须有测试用独立公式重算答案。**

不允许「我算过了，是对的」。参见 `src/lib/quiz/kv-cache-questions.spec.ts`——
它用 KV Cache 公式独立重算每一道题，题目数值写错 CI 会拦住。

理由：错误的技术内容比没有内容更糟，它会毁掉笔记仓库积累的信誉。

---

## 禁止事项

| 禁止                                          | 原因                                |
| --------------------------------------------- | ----------------------------------- |
| 收录无法程序判定的题目                        | 违反产品立足点                      |
| 数值题没有独立重算测试                        | 错误内容会被发出去                  |
| 编造质量损失、性能提升等无法验证的数字        | 必须标注为「示意性估算」，或不写    |
| 加徽章、连续登录天数、公开排行榜              | 见下方设计原则                      |
| 提交 `build/`、`.svelte-kit/`、临时脚本、截图 | 已在 `.gitignore`，但临时文件容易漏 |
| 引入新依赖而不说明理由                        | 尤其是能用现有依赖替代的            |
| 直接 push 到 main                             | 走 PR，让 CI 把关                   |

---

## 设计原则（做产品决策时的依据）

**可判定，不是自评。** 判定由程序说了算。

**答错是入口，不是惩罚。** 第一次错给提示并允许重答，第二次错才公布完整推导。
选错的干扰项要给出针对那个具体误解的解释——干扰项必须来自真实的常见误解，不是凑数。

**间隔重复，不是每日打卡。** 答对的题按 1/3/7/16/35 天排复习。
刻意不做连续登录天数：连击奖励「每天来点一下」，而深度技术内容需要「偶尔沉浸两小时」，
两者激励方向相反。会话内连击可以有（即时反馈），跨天连击不做（打卡负债）。

**不做徽章和排行榜。** [教育软件游戏化的负面效果综述](https://arxiv.org/abs/2305.08346)
发现徽章、排行榜、竞赛、积分是最常引发负面效果的四类元素。
受众是在职工程师，小红花是居高临下。他们要的是知道自己不知道什么。

**反馈必须快于 300ms。** 慢了就失去「击中感」。当前动画控制在 180ms。

**视觉克制。** 低饱和、专业感，参考 Linear / Vercel。不要卡通游戏风——
唯一的例外是吉祥物，边界见第 21 条。浅色与深色两套主题都要维护，浅色是默认。

---

## 技术栈要点

SvelteKit 2 + Svelte 5 runes + adapter-static + Tailwind 4 + Vitest 4。

- **没有 `svelte.config.js`**。adapter 和 compilerOptions 都配在 `vite.config.ts` 里
- runes 模式已强制开启（`runes: true`），用 `$state` / `$derived` / `$props`，不要用旧的 `export let`
- Tailwind 4 是 CSS-first 配置，`@theme` 写在 `src/routes/layout.css`，没有 `tailwind.config.js`
- 测试分两个 project：`server`（Node 跑 `*.spec.ts`）和 `client`（真实 Chromium 跑 `*.svelte.spec.ts`）
- `@vitest/browser` 必须显式安装才有 `userEvent` 类型（`browser-playwright` 只是重导出）

---

## 提交前检查清单

- [ ] `pnpm run check:all` 全绿
- [ ] `pnpm run test:smoke` 全绿
- [ ] 新增数值题都有独立重算测试
- [ ] 新增内部链接都用了 `resolve()`
- [ ] 换题的地方用了 `{#key}`
- [ ] 没有提交临时文件、截图、产物
- [ ] 无法验证的数字标注了「示意性估算」或已删除

---

## 写新关卡

见 `docs/level-authoring.md`。
