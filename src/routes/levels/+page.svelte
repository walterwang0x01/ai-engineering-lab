<script lang="ts">
	/**
	 * 关卡索引页。
	 *
	 * 存在的理由来自零上下文可用性复查的两条严重度 3：
	 *
	 *   1. 导航里的「关卡」指向首页本身，点了页面不变——复查者的第一反应是
	 *      「链接坏了」。
	 *   2. 全站没有关卡索引：5 个关卡只能在学习路径里散着找到，
	 *      而「可判定题 + 参数沙盒」正是这个站唯一别人没有的东西。
	 *
	 * 这一页同时解决了第三条：代码题被埋在第 9 题。这里直接标出哪一关有代码题、
	 * 有几道，让最独特的卖点在导航一层就能看见。
	 *
	 * ## 这一版重做解决的三件事
	 *
	 * 1. **算出来又扔掉的进度**。`summarizeMastery` 返回四档
	 *    （已掌握 / 在学 / 需重练 / 未做），而卡片只渲染了一个 `done` 数字——
	 *    「10 / 12 做过」既分不出哪些真掌握了，也看不出哪些答错过要重练。
	 *    首页的模块行早就在用分段条表达这四档，索引页却把同一份数据压成了一个分数。
	 * 2. **一整页没有任何可操作的东西**。6 张卡片一列排开，用户只能滚动。
	 *    加了筛选：想找代码题、想接着做没做完的、想挑没开始的，都是真实意图。
	 * 3. **对中文无效的英文眉标样式**。`text-transform: uppercase` 对「关卡」
	 *    做不了任何事，`letter-spacing` 只会把方块字推散——和首页那处同源问题。
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import { LEVELS } from '$lib/levels/registry';
	import { notesForLevel } from '$lib/curriculum/mapping';
	import { INTERVALS_DAYS, isDue, summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';

	let ready = $state(false);

	onMount(() => {
		progress.load();
		ready = true;
	});

	const rows = $derived(
		LEVELS.map((level) => {
			const ids = level.questions.map((q) => q.id);
			const mastery = summarizeMastery(ids, progress.scheduleView);
			return {
				level,
				mastery,
				done: mastery.total - mastery.untouched,
				codeCount: level.questions.filter((q) => q.kind === 'code').length,
				numericCount: level.questions.filter((q) => q.kind === 'numeric').length,
				choiceCount: level.questions.filter((q) => q.kind === 'choice').length,
				backgroundNotes: notesForLevel(level.id).length
			};
		})
	);

	/**
	 * 筛选。
	 *
	 * 默认必须是「全部」：冒烟测试断言索引页列出全部关卡，
	 * 而且首次访问时把卡片藏起来毫无道理。
	 */
	type Filter = 'all' | 'todo' | 'doing' | 'code';
	let filter = $state<Filter>('all');

	const FILTERS: readonly { id: Filter; label: string }[] = [
		{ id: 'all', label: '全部' },
		{ id: 'todo', label: '没开始' },
		{ id: 'doing', label: '做了一半' },
		{ id: 'code', label: '有代码题' }
	];

	const visibleRows = $derived(
		rows.filter((r) => {
			if (filter === 'all') return true;
			if (filter === 'code') return r.codeCount > 0;
			// 进度还没从 localStorage 读出来时不做进度类筛选，否则会闪一下空列表
			if (!ready) return true;
			if (filter === 'todo') return r.done === 0;
			return r.done > 0 && r.mastery.mastered < r.mastery.total;
		})
	);

	/** 每个筛选项能命中几关，直接标在按钮上——避免点进去才发现是空的 */
	function countFor(id: Filter): number {
		if (id === 'all') return rows.length;
		if (id === 'code') return rows.filter((r) => r.codeCount > 0).length;
		if (!ready) return 0;
		if (id === 'todo') return rows.filter((r) => r.done === 0).length;
		return rows.filter((r) => r.done > 0 && r.mastery.mastered < r.mastery.total).length;
	}

	function pct(n: number, total: number): number {
		return total === 0 ? 0 : (n / total) * 100;
	}

	/**
	 * 今天到期需要复习的题，按关卡分组。
	 *
	 * 零上下文复查里唯一的**功能缺口**：页尾承诺「答对的题按 1、3、7、16、35 天
	 * 安排复习」，但全站导航只有关卡和笔记库，没有任何「今天该复习什么」的入口。
	 * `dueAt` 一直写进了 localStorage，用户却看不到它。复查者的原话：
	 * 「这是承诺了一个我看不到的功能」。
	 */
	const dueByLevel = $derived(
		LEVELS.map((level) => {
			const due = level.questions.filter((q) => {
				const rec = progress.get(q.id);
				return rec !== undefined && rec.box > 0 && isDue(rec.dueAt, Date.now());
			});
			return { level, count: due.length };
		}).filter((r) => r.count > 0)
	);

	const dueTotal = $derived(dueByLevel.reduce((n, r) => n + r.count, 0));

	/** 一道题都没到期时，最近的一次复习还有多久 */
	const nextDueInDays = $derived.by(() => {
		const dues = LEVELS.flatMap((l) => l.questions)
			.map((q) => progress.get(q.id))
			.filter((r) => r !== undefined && r.box > 0)
			.map((r) => r!.dueAt);
		if (dues.length === 0) return null;
		const soonest = Math.min(...dues);
		return Math.max(0, Math.ceil((soonest - Date.now()) / 86_400_000));
	});

	const totals = $derived({
		questions: rows.reduce((n, r) => n + r.mastery.total, 0),
		code: rows.reduce((n, r) => n + r.codeCount, 0),
		mastered: rows.reduce((n, r) => n + r.mastery.mastered, 0),
		interactive: rows.filter((r) => r.level.interactive).length
	});

	/** 全站总进度，给页头那条总览条用 */
	const overall = $derived(
		summarizeMastery(
			LEVELS.flatMap((l) => l.questions.map((q) => q.id)),
			progress.scheduleView
		)
	);
</script>

<!--
	描述由数据推导，**不写死数字**。

	原文硬编码「5 个关卡、52 道可判定题」，而 deploy-decision 上线后实际是
	6 关 62 道 —— 加一关就让搜索结果里的文案变成假话，且没有任何东西会报错。
	这类漂移只能靠「不留下写死的机会」来防。
-->
<Seo
	title="全部关卡 · AI Engineering Lab"
	description="{LEVELS.length} 个关卡、{totals.questions} 道可判定题、{totals.code} 道在浏览器里真跑 Python 的代码题。每关配一个参数沙盒或可交互演示，答错会告诉你错在哪。"
	ogImage="home.png"
/>

<main>
	<header class="page-head">
		<p class="eyebrow">关卡</p>
		<h1>动手的部分</h1>
		<p class="lede">
			每关是一组<b>能判定对错的题</b>加一个<b>能调参数的交互</b>。
			题目答错会给出针对那个误解的解释，代码题在你的浏览器里真跑 Python、用断言判定。
		</p>

		<dl class="head-stats">
			<div>
				<dt>{totals.questions}</dt>
				<dd>道可判定题</dd>
			</div>
			<div>
				<dt>{totals.code}</dt>
				<dd>道跑真 Python</dd>
			</div>
			<div>
				<dt>{totals.interactive}</dt>
				<dd>个可交互演示</dd>
			</div>
			<div>
				<dt class:ok={ready && totals.mastered > 0}>{ready ? totals.mastered : 0}</dt>
				<dd>道已掌握</dd>
			</div>
		</dl>

		{#if ready && overall.total - overall.untouched > 0}
			<!--
				全站总进度条。四档用同一套语义色，和首页模块行、图例保持一致：
				绿=已掌握、琥珀=在学、红=需重练、灰轨=没做过。
			-->
			<div class="track" data-testid="overall-bar" aria-hidden="true">
				<i class="seg ok" style="width: {pct(overall.mastered, overall.total)}%"></i>
				<i class="seg warn" style="width: {pct(overall.learning, overall.total)}%"></i>
				<i class="seg bad" style="width: {pct(overall.struggling, overall.total)}%"></i>
			</div>
			<p class="track-legend">
				已掌握 {overall.mastered} · 在学 {overall.learning} · 需重练 {overall.struggling} · 没做过
				{overall.untouched}
			</p>
		{:else}
			<p class="sub">进度只存在这台设备的浏览器里，没有账号，不上传。</p>
		{/if}
	</header>

	{#if ready && (dueTotal > 0 || nextDueInDays !== null)}
		<section class="review" class:urgent={dueTotal > 0} data-testid="review-panel">
			{#if dueTotal > 0}
				<h2 class="review-title">今天有 {dueTotal} 道题到期复习</h2>
				<p class="review-body">
					间隔重复按 {INTERVALS_DAYS.slice(1).join('、')} 天排。到期的题会自动排在关卡队列的前面，进去就能做。
				</p>
				<ul class="review-list">
					{#each dueByLevel as row (row.level.id)}
						<li>
							<a href={resolve('/[levelId]', { levelId: row.level.id })}>
								{row.level.title}
								<span class="review-n">{row.count} 道</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<h2 class="review-title">今天没有到期的题</h2>
				<p class="review-body">
					{#if nextDueInDays === 0}
						最近的一道就在今天之内到期。
					{:else}
						最近的一道大约 {nextDueInDays} 天后回到队列。答对的题不会立刻再问你——隔几天再检索才能区分「真记住了」和「刚看过」。
					{/if}
				</p>
			{/if}
		</section>
	{/if}

	<!--
		筛选。用 radio 而不是一排 button：这是「从若干互斥项里选一个」，
		radiogroup 的语义让读屏器能播报「4 项中的第 2 项」，button 组做不到。
	-->
	<fieldset class="filters" data-testid="level-filters">
		<legend>怎么挑</legend>
		<div class="chips">
			{#each FILTERS as f (f.id)}
				{@const n = countFor(f.id)}
				<label class="chip" class:on={filter === f.id} class:empty={n === 0}>
					<input type="radio" name="level-filter" value={f.id} bind:group={filter} />
					<span>{f.label}</span>
					<span class="chip-n">{n}</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<ol class="levels" data-testid="level-index">
		{#each visibleRows as row (row.level.id)}
			<!--
				编号取自**全量** rows 而不是循环下标：筛选后「02」必须还是那一关，
				否则筛出两张卡就变成 01、02，和用户记住的编号对不上。
			-->
			{@const idx = rows.findIndex((r) => r.level.id === row.level.id)}
			<li>
				<a class="card" href={resolve('/[levelId]', { levelId: row.level.id })}>
					<div class="card-top">
						<span class="num" aria-hidden="true">{String(idx + 1).padStart(2, '0')}</span>
						<span class="tag">{row.level.card.tag}</span>
						{#if ready && row.mastery.mastered === row.mastery.total}
							<span class="state state-done">已通关</span>
						{:else if ready && row.done > 0}
							<span class="state state-on">{row.done} / {row.mastery.total} 做过</span>
						{:else}
							<span class="state">{row.mastery.total} 道题</span>
						{/if}
					</div>

					<h2>{row.level.title}</h2>
					<p class="summary">{row.level.card.summary}</p>

					{#if ready && row.done > 0}
						<!--
							每关自己的四档进度。原来这里只有「10 / 12 做过」——
							同一个分数既可能是十道全掌握，也可能是十道全答错过，
							而这两种情况下你该做的事完全不同。
						-->
						<div class="track thin" aria-hidden="true">
							<i class="seg ok" style="width: {pct(row.mastery.mastered, row.mastery.total)}%"></i>
							<i class="seg warn" style="width: {pct(row.mastery.learning, row.mastery.total)}%"
							></i>
							<i class="seg bad" style="width: {pct(row.mastery.struggling, row.mastery.total)}%"
							></i>
						</div>
						<p class="card-legend">
							{#if row.mastery.mastered > 0}掌握 {row.mastery.mastered}{/if}
							{#if row.mastery.learning > 0}
								· 在学 {row.mastery.learning}{/if}
							{#if row.mastery.struggling > 0}
								· <b class="need">需重练 {row.mastery.struggling}</b>{/if}
						</p>
					{/if}

					<ul class="facts">
						{#if row.numericCount > 0}<li>{row.numericCount} 道计算题</li>{/if}
						{#if row.choiceCount > 0}<li>{row.choiceCount} 道选择题</li>{/if}
						{#if row.codeCount > 0}
							<li class="fact-code">{row.codeCount} 道代码题 · 浏览器里跑 Python</li>
						{/if}
						{#if row.level.interactive}<li>1 个可交互演示</li>{/if}
						{#if row.backgroundNotes > 0}<li>{row.backgroundNotes} 篇背景笔记</li>{/if}
					</ul>

					<span class="cta">
						{#if ready && row.mastery.mastered === row.mastery.total && row.mastery.total > 0}
							重做一遍 →
						{:else if ready && row.done > 0}
							继续 →
						{:else}
							开始 →
						{/if}
					</span>
				</a>
			</li>
		{/each}
	</ol>

	{#if visibleRows.length === 0}
		<p class="empty" data-testid="filter-empty">
			这个条件下没有关卡。<button type="button" onclick={() => (filter = 'all')}>看全部</button>
		</p>
	{/if}

	<footer class="page-foot">
		<a href={resolve('/')}>← 学习路径</a>
		<a href={resolve('/notes')}>笔记库 →</a>
	</footer>
</main>

<style>
	main {
		max-width: 60rem;
		margin: 0 auto;
		padding: var(--space-7) var(--space-5) var(--space-8);
		display: grid;
		gap: var(--space-6);
	}

	.page-head {
		display: grid;
		gap: var(--space-3);
	}

	/*
	 * 眉标不再用 uppercase + letter-spacing：那对中文做不了任何事
	 * （「关卡」没有大小写可转），字距只会把方块字推散。
	 * 换成小号 + 强调色 + 字重，中文里同样能读出「这是眉标」。
	 */
	.eyebrow {
		margin: 0;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--color-accent);
	}

	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		line-height: 1.2;
		letter-spacing: -0.02em;
		color: var(--color-text-strong);
	}

	.lede {
		margin: 0;
		font-size: var(--fs-md);
		line-height: 1.75;
		color: var(--color-text);
		max-width: 42rem;
	}

	.lede b {
		color: var(--color-text-strong);
	}

	.sub {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.7;
		color: var(--color-text-muted);
	}

	/* ── 页头数字带 ── */
	.head-stats {
		margin: var(--space-2) 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6);
		padding: var(--space-4) var(--space-5);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
	}

	.head-stats dt {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.02em;
		color: var(--color-text-strong);
	}

	.head-stats dt.ok {
		color: var(--color-ok);
	}

	.head-stats dd {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}

	/* ── 四档进度条 ── */
	.track {
		display: flex;
		height: 8px;
		/* 轨道用 --color-track 而不是 sunken：新用户所有进度都是 0，
		   轨道是那一刻唯一可见的部分，sunken 在浅色下只有 1.1:1 等于不存在 */
		background: var(--color-track);
		border-radius: 999px;
		overflow: hidden;
	}

	.track.thin {
		height: 5px;
		margin-top: var(--space-1);
	}

	.seg {
		transition: width var(--dur-ui) var(--ease-out);
	}

	.seg.ok {
		background: var(--color-ok);
	}

	.seg.warn {
		background: var(--color-warn);
	}

	.seg.bad {
		background: var(--color-bad);
	}

	.track-legend {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}

	.card-legend {
		margin: 0;
		font-size: var(--fs-2xs);
		color: var(--color-text-muted);
	}

	.card-legend .need {
		color: var(--color-bad-text);
		font-weight: 600;
	}

	/* ── 复习面板 ── */
	.review {
		padding: var(--space-4) var(--space-5);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		display: grid;
		gap: var(--space-2);
	}

	/* 有到期的题时才用强调色描边——没到期时它只是一句说明，不该抢注意力 */
	.review.urgent {
		border-color: var(--color-accent-dim);
		border-left: 3px solid var(--color-accent);
	}

	.review-title {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--color-text-strong);
	}

	.review-body {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.review-list {
		margin: var(--space-1) 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.review-list a {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		color: inherit;
		text-decoration: none;
		font-size: var(--fs-sm);
		transition: border-color var(--dur-ui) var(--ease-out);
	}

	.review-list a:hover {
		border-color: var(--color-accent);
	}

	.review-n {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--color-warn);
	}

	/* ── 筛选 ── */
	.filters {
		margin: 0;
		padding: 0;
		border: 0;
		display: grid;
		gap: var(--space-2);
	}

	.filters legend {
		padding: 0;
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-control);
		background: var(--color-surface-raised);
		/* 无底色差异时边框是它唯一的可点线索，所以用 strong 而不是 subtle */
		border: 1px solid var(--color-border-strong);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--color-text-soft);
		cursor: pointer;
		transition:
			border-color var(--dur-verdict) var(--ease-out),
			background var(--dur-verdict) var(--ease-out),
			color var(--dur-verdict) var(--ease-out);
	}

	/* radio 隐藏但保留可聚焦 —— display:none 会让键盘拿不到它 */
	.chip input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.chip:hover {
		border-color: var(--color-accent);
	}

	.chip.on {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-on-accent);
	}

	/* 命中 0 关时降权但**不禁用**：它仍然可点，点了会看到空状态和出路 */
	.chip.empty:not(.on) {
		color: var(--color-text-faint);
	}

	.chip:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.chip-n {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 400;
	}

	.chip.on .chip-n {
		color: var(--color-on-accent);
	}

	/* ── 关卡卡片 ── */
	.levels {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-4);
	}

	.card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-5);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-left: 2px solid var(--color-accent);
		border-radius: var(--radius-card);
		text-decoration: none;
		color: inherit;
		box-shadow: var(--shadow-card);
		height: 100%;
		transition:
			border-color var(--dur-ui) var(--ease-out),
			box-shadow var(--dur-ui) var(--ease-out),
			transform var(--dur-ui) var(--ease-out);
	}

	/*
	 * 可点的卡片要有抬起反馈：位移 + 阴影加深，不做 scale——
	 * 缩放会让卡片里的文字在动画过程中发虚。
	 *
	 * 这里刻意只有一条 hover 规则。先前是 `.card:hover` 和 `a.card:hover` 各设一个
	 * translateY（1px 与 2px），后者更具体所以前者的位移被静默吃掉——两条规则对
	 * 同一件事给出矛盾的值，只有一个生效，是下次改动踩坑的来源。
	 */
	a.card:hover {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-lift);
		transform: translateY(-2px);
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.num {
		font-family: var(--font-mono);
		font-size: var(--fs-base);
		font-weight: 600;
		color: var(--color-text-faint);
	}

	.tag {
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		padding: 0.1875rem var(--space-2);
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		color: var(--color-accent);
	}

	.state {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}

	.state-done {
		color: var(--color-ok);
	}

	.state-on {
		color: var(--color-warn);
	}

	h2 {
		margin: 0;
		font-size: var(--fs-lg);
		line-height: 1.25;
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
	}

	.summary {
		margin: 0;
		font-size: var(--fs-base);
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.facts {
		margin: var(--space-1) 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.facts li {
		font-size: var(--fs-xs);
		padding: 0.1875rem var(--space-2);
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		color: var(--color-text-soft);
	}

	/* 代码题是这个站最独特的东西，在索引页就要看得见 */
	.fact-code {
		color: var(--color-accent);
		border-color: var(--color-accent-dim);
	}

	.cta {
		margin-top: var(--space-1);
		font-size: var(--fs-base);
		font-weight: 600;
		color: var(--color-accent);
	}

	/* ── 空状态 ── */
	.empty {
		margin: 0;
		padding: var(--space-5);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		font-size: var(--fs-sm);
		color: var(--color-text-soft);
	}

	.empty button {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: underline;
	}

	.page-foot {
		display: flex;
		gap: var(--space-5);
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--space-5);
		font-size: var(--fs-base);
	}

	.page-foot a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--color-accent);
		text-decoration: none;
	}

	.page-foot a:hover {
		text-decoration: underline;
	}

	/*
	 * 宽屏两列。6 张卡片单列排开会让页面变成一条很长的滚动带，
	 * 而卡片本身的信息量（标题 + 摘要 + 进度 + 事实条）撑得起半屏宽度。
	 */
	@media (min-width: 52rem) {
		.levels {
			grid-template-columns: 1fr 1fr;
			gap: var(--space-4);
		}
	}
</style>
