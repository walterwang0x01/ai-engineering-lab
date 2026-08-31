<script lang="ts">
	/**
	 * 首页精选动手笔记卡片。
	 *
	 * ## 为什么有这一块
	 *
	 * 之前首页讲「这里每个概念都配能调参数的沙盒」是一句**承诺**，但首页**自己**
	 * 没有兑现：除了 hero 那个 KV Cache 内存探测器，看不到别的东西在动。
	 * 用户停在首页最常见的下一步是「去 /notes 看看有什么」，可 /notes 是一个
	 * 168 篇的长列表——「能动手」散在里面，不勾筛选根本看不出来。
	 *
	 * 所以这里把 5 类动手笔记各挑 1 篇直接显在首页：每张卡片显示默认值下的
	 * 关键指标，让用户在没滚到任何笔记正文之前就先看见「参数变化 → 数字变 →
	 * 跨过约束变红」这件事真的存在。点卡片跳进去就是该笔记的 `InteractionHost`，
	 * 那才是真正能拖的地方。
	 *
	 * ## 为什么只放 5 篇
	 *
	 * 全站共 15 篇可调实验（5 旧沙盒 + 10 新声明式），但首页是入口页：
	 * 一屏铺 15 张卡片和「又是一面墙」没区别，反而模糊了「5 种类型的代表」
	 * 这个信息。挑 5 篇是**有意为之**——代表的是 5 种 spec.type，覆盖公式
	 * / 成本 / 决策 / 约束 / 模拟五类，让用户意识到「动手」不是一种玩法，
	 * 是多种。剩下 10 篇在 /notes 的筛选里、徽章已经在那了。
	 *
	 * ## 体积代价
	 *
	 * 引入 specs.ts 让首页多 ~20KB（gzip 后 ~8KB）的计算模型。specs 是纯
	 * 函数 + 常量，无 DOM 操作；首页静态 import 是可以接受的代价，
	 * 换来的是「默认值下能看到真实数字」而不是占位符。如果以后首页体积
	 * 真的压不动，正确的做法是把 5 个 spec 的 metadata 搬出来而不是
	 * 拆 chunk——首页 hero 的 KV Cache 探测器也是同样思路：内联算法不拆。
	 */
	import { resolve } from '$app/paths';
	import {
		API_COST_SPEC,
		FRAMEWORK_DECISION_SPEC,
		MODEL_MERGE_SPEC,
		SYNTHETIC_DATA_SPEC,
		VOICE_LATENCY_SPEC
	} from '$lib/interactions/specs';
	import type {
		InteractionEvaluation,
		InteractionSpec,
		InteractionTone
	} from '$lib/interactions/types';

	interface FeaturedNote {
		spec: InteractionSpec;
		/** 笔记 slug。决定点了卡片跳去哪里 */
		slug: string;
	}

	const FEATURED: readonly FeaturedNote[] = [
		{
			spec: MODEL_MERGE_SPEC,
			slug: '02-llm/04-微调与对齐/05-模型合并'
		},
		{
			spec: API_COST_SPEC,
			slug: '04-ai-agent/12-模型服务/01-OpenAI与Claude API'
		},
		{
			spec: FRAMEWORK_DECISION_SPEC,
			slug: '04-ai-agent/04-Agent框架补充/01-Agent框架选型指南'
		},
		{
			spec: VOICE_LATENCY_SPEC,
			slug: '04-ai-agent/19-Voice Agent/01-语音Agent与实时交互'
		},
		{
			spec: SYNTHETIC_DATA_SPEC,
			slug: '02-llm/04-微调与对齐/06-合成数据生成'
		}
	];

	/**
	 * spec.type 翻成面向读者的中文标签。
	 *
	 * InteractionSpec.type 是给程序用的枚举（'formula' / 'cost' / ...）。
	 * 直接展示英文会让中文读者觉得是「代码分类」而不是「玩法分类」；
	 * 翻译成中文能强化「动手」是日常的、不止一种。
	 */
	const TYPE_LABEL: Record<InteractionSpec['type'], string> = {
		formula: '公式型',
		cost: '成本型',
		decision: '决策型',
		constraint: '约束型',
		simulation: '模拟型'
	};

	function defaultsOf(spec: InteractionSpec): Record<string, number> {
		return Object.fromEntries(spec.parameters.map((p) => [p.id, p.defaultValue]));
	}

	/** 一张卡片上要展示的内容：默认值下的 evaluation + 渲染字段 */
	interface MetricLine {
		label: string;
		value: string;
		tone: InteractionTone;
	}

	interface CardData {
		featured: FeaturedNote;
		evaluation: InteractionEvaluation;
		/**
		 * 第一个 metric 一定存在（spec.evaluate 都至少返回一个）。
		 * 第二个 metric 可选——agent-framework-decision 这种 spec 就只输出一个
		 * 「领先优势」指标，整页靠 ranking 列表撑内容，强行填第二个 metric 会越界。
		 */
		first: MetricLine;
		second: MetricLine | null;
	}

	function format(value: number, digits?: number): string {
		return new Intl.NumberFormat('zh-CN', {
			maximumFractionDigits: digits ?? 1,
			minimumFractionDigits: 0
		}).format(value);
	}

	function metricLine(metric: InteractionEvaluation['metrics'][number]): MetricLine {
		return {
			label: metric.label,
			value: `${format(metric.value, metric.digits)}${metric.unit ?? ''}`,
			tone: metric.tone ?? 'neutral'
		};
	}

	const CARDS: readonly CardData[] = FEATURED.map((featured) => {
		const evaluation = featured.spec.evaluate(defaultsOf(featured.spec));
		const [first, second] = evaluation.metrics;
		return {
			featured,
			evaluation,
			first: metricLine(first),
			second: second ? metricLine(second) : null
		};
	});

	/**
	 * 卡片跳到笔记的完整 URL。
	 *
	 * ESLint 规则 `no-navigation-without-resolve` 是按**返回类型**放行的：
	 * SvelteKit 的 ResolvedPathname 是个 brand 类型，规则不跑运行时检查，
	 * 所以可以把 `resolve(...)` 的结果拼上 hash 再断言回去，刚好过类型检查。
	 * 这样 prettier 把 `<a>` 拆成多行时不用 disable-next-line 包整块。
	 */
	function hrefFor(featured: FeaturedNote): ReturnType<typeof resolve> {
		return `${resolve('/notes/[...slug]', { slug: featured.slug })}#interaction-${featured.spec.id}` as ReturnType<
			typeof resolve
		>;
	}
</script>

<section class="featured" data-testid="featured-interactions" aria-labelledby="featured-heading">
	<header class="head">
		<h2 id="featured-heading" class="section-title">动手笔记精选</h2>
		<p class="lede">
			5 篇不同类型的代表：拖一个参数，看一个数先变——拖过头，约束会告诉你。
			去对应笔记里玩完整的滑块与预设。
		</p>
	</header>

	<ul class="cards" data-testid="featured-cards">
		{#each CARDS as card (card.featured.spec.id)}
			<li>
				<a
					class="card"
					href={hrefFor(card.featured)}
					data-testid={`featured-card-${card.featured.spec.id}`}
				>
					<p class="type" data-tone={card.first.tone}>{TYPE_LABEL[card.featured.spec.type]}</p>
					<h3 class="title">{card.featured.spec.title}</h3>
					<p class="desc">{card.featured.spec.description}</p>

					<dl class="metrics">
						<div class="metric" data-tone={card.first.tone}>
							<dt class="metric-label">{card.first.label}</dt>
							<dd class="metric-value">{card.first.value}</dd>
						</div>
						{#if card.second}
							<div class="metric" data-tone={card.second.tone}>
								<dt class="metric-label">{card.second.label}</dt>
								<dd class="metric-value">{card.second.value}</dd>
							</div>
						{:else}
							<!--
								部分 spec（如 agent-framework-decision）默认输出只有一个 metric。
								不让空 div 占位而坏掉 grid：保留两列、让 .metric-1 auto-spans 或
								让 value 一栏撑满。这里用最小改动——空 div + visibility:hidden 维持布局：
								实际上，让它撑得越满越好，让 metric 占整行、凸显「这个决策很突出」。
							-->
							<div class="metric metric-solo" data-tone={card.first.tone}>
								<dt class="metric-label sr-only">{card.first.label}（唯一指标）</dt>
								<dd class="metric-value metric-value-solo">{card.first.value}</dd>
							</div>
						{/if}
					</dl>

					<!--
						结尾小字告诉读者点过去之后看到什么。
						「去这篇笔记里玩 →」是新按钮文案，
						「点过去就能拖滑块看数字变化」是隐含承诺——
						我们用 InteractionHost 真兑现，前面也提到了。
					-->
					<span class="go" aria-hidden="true">去这篇笔记里玩 →</span>
				</a>
			</li>
		{/each}
	</ul>
</section>

<style>
	.featured {
		display: grid;
		gap: var(--space-5);
	}

	.head {
		display: grid;
		gap: var(--space-2);
	}

	.section-title {
		margin: 0;
		font-size: var(--fs-lg);
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
		font-weight: 600;
		line-height: 1.3;
	}

	.lede {
		margin: 0;
		font-size: var(--fs-base);
		line-height: 1.7;
		color: var(--color-text-muted);
		max-width: 38rem;
	}

	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--space-3);
	}

	li {
		display: contents;
	}

	.card {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-4);
		min-height: 14rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		text-decoration: none;
		color: inherit;
		box-shadow: var(--shadow-card);
		transition:
			border-color var(--dur-ui) var(--ease-out),
			box-shadow var(--dur-ui) var(--ease-out),
			transform var(--dur-ui) var(--ease-out);
	}

	.card:hover {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-lift);
		transform: translateY(-1px);
	}

	.type {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		/* 默认是中性灰；tone 为 ok/warn/bad 时被下方的选择器覆盖 */
		color: var(--color-text-muted);
		text-transform: uppercase;
		/* 标签里只有 2–3 个汉字，没有大小写可转，去掉空格均匀输出 */
	}

	.type[data-tone='ok'] {
		color: var(--color-ok);
	}

	.type[data-tone='warn'] {
		color: var(--color-warn);
	}

	.type[data-tone='bad'] {
		color: var(--color-bad);
	}

	.title {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		line-height: 1.35;
		color: var(--color-text-strong);
		letter-spacing: -0.01em;
	}

	.desc {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.metrics {
		margin: 0;
		padding: var(--space-3) 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
	}

	.metric {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}

	/*
	 * 单指标卡片：让那一个数字占满 2 列、字号略大、凸显「这是这一类的关键结论」。
	 * agent-framework-decision 默认只返回「领先优势」一个 metric，
	 * 强行填第二个会让卡片说谎。
	 */
	.metric-solo {
		grid-column: 1 / -1;
	}

	.metric-label {
		font-size: var(--fs-xs);
		color: var(--color-text-faint);
		/* 长 label 不能撑破格子 */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.metric-value {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--color-text-strong);
		letter-spacing: -0.01em;
	}

	.metric[data-tone='ok'] .metric-value {
		color: var(--color-ok);
	}

	.metric[data-tone='warn'] .metric-value {
		color: var(--color-warn);
	}

	.metric[data-tone='bad'] .metric-value {
		color: var(--color-bad);
	}

	.metric-value-solo {
		font-size: var(--fs-lg);
	}

	/*
	 * 单指标卡片只读一次数字，但视觉上让标签也出现一次显得重复。
	 * sr-only 隐藏标签，但 screen reader 仍能听到「（唯一指标）」修饰。
	 */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.go {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--color-accent);
	}

	@media (max-width: 34rem) {
		/* 触摸目标 ≥ 44px（WCAG 2.5.5）。牌面上整张卡是 <a>，
		   但 title 字号大、视觉重心在卡片整体，所以全局再补一点内边距 */
		.card {
			padding: var(--space-4) var(--space-4) var(--space-5);
		}
	}
</style>
