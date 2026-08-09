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

**不要配 `paths.base`**：SvelteKit 默认 `paths.relative: true`，产物已是相对路径，子路径自动正确。已用 `BASE_PATH` 有无做对比构建验证过，输出完全一致。

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

### 11. OG 模板的 flex 子项必须 `flex-shrink: 0` + `white-space: nowrap`

否则中文被压缩换行：「可判定」变「可判/定」、「320 GB」变「320/GB」。

`scripts/generate-og.mjs` 里已有程序化溢出检测（`scrollWidth > clientWidth` 就报错退出）。
**不要删掉那段检测**——目测很容易漏掉换行。

---

## 目录职责

```
src/lib/quiz/          判定与调度的纯逻辑，不含 UI
  types.ts             题目与判定结果的类型契约
  judge.ts             判定引擎（数值容差、选择题）
  schedule.ts          Leitner 间隔重复（纯函数，不碰存储）
  validate.ts          题库校验（id 命名空间、结构、答案自洽）
  *-questions.ts       题库数据。每个关卡一个文件

src/lib/storage/       持久化
  backend.ts           StorageBackend 接口 + localStorage / 内存两种实现
  progress.svelte.ts   Svelte 5 runes 状态。文件名必须以 .svelte.ts 结尾才能用 runes

src/lib/components/    UI 组件
src/routes/            页面
  layout.css           设计系统（@theme token）。改配色只改这里
e2e/smoke.mjs          全链路冒烟测试，自管服务器生命周期
scripts/generate-og.mjs  OG 图生成（手动跑，不进构建）
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

**视觉克制。** 深色、低饱和、专业感，参考 Linear / Vercel。不要卡通游戏风。

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
