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
		mastered: rows.reduce((n, r) => n + r.mastery.mastered, 0)
	});
</script>

<Seo
	title="全部关卡 · AI Engineering Lab"
	description="5 个关卡、52 道可判定题、9 道在浏览器里真跑 Python 的代码题。每关配一个参数沙盒或可交互演示，答错会告诉你错在哪。"
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
		<p class="sub">
			共 {totals.questions} 道题，其中 {totals.code} 道是代码题{#if ready && totals.mastered > 0}，你已掌握
				{totals.mastered} 道{/if}。进度只存在这台设备的浏览器里。
		</p>
	</header>

	{#if ready && (dueTotal > 0 || nextDueInDays !== null)}
		<section class="review" data-testid="review-panel">
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

	<ol class="levels" data-testid="level-index">
		{#each rows as row, i (row.level.id)}
			<li>
				<a class="card" href={resolve('/[levelId]', { levelId: row.level.id })}>
					<div class="card-top">
						<span class="num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
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

					<ul class="facts">
						{#if row.numericCount > 0}<li>{row.numericCount} 道计算题</li>{/if}
						{#if row.choiceCount > 0}<li>{row.choiceCount} 道选择题</li>{/if}
						{#if row.codeCount > 0}
							<li class="fact-code">{row.codeCount} 道代码题 · 浏览器里跑 Python</li>
						{/if}
						{#if row.level.interactive}<li>1 个可交互演示</li>{/if}
						{#if row.backgroundNotes > 0}<li>{row.backgroundNotes} 篇背景笔记</li>{/if}
					</ul>

					<span class="cta">{ready && row.done > 0 ? '继续 →' : '开始 →'}</span>
				</a>
			</li>
		{/each}
	</ol>

	<footer class="page-foot">
		<a href={resolve('/')}>← 学习路径</a>
		<a href={resolve('/notes')}>笔记库 →</a>
	</footer>
</main>

<style>
	main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
		display: grid;
		gap: 2.5rem;
	}

	.page-head {
		display: grid;
		gap: 0.75rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.8125rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-accent);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.75rem, 4vw, 2.25rem);
		line-height: 1.25;
	}

	.lede {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.75;
		color: var(--color-text);
		max-width: 42rem;
	}

	.lede b {
		color: var(--color-text-strong);
	}

	.sub {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--color-text-faint);
	}

	.review {
		padding: 1.25rem 1.5rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-accent-dim);
		border-radius: var(--radius-card);
		display: grid;
		gap: 0.5rem;
	}

	.review-title {
		margin: 0;
		font-size: 1.0625rem;
	}

	.review-body {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.review-list {
		margin: 0.25rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.review-list a {
		display: inline-flex;
		align-items: center;
		gap: 0.4375rem;
		min-height: 44px;
		padding: 0 0.75rem;
		border-radius: var(--radius-control);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		color: inherit;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.review-list a:hover {
		border-color: var(--color-accent);
	}

	.review-n {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-warn);
	}

	.levels {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 1rem;
	}

	.card {
		display: grid;
		gap: 0.625rem;
		padding: 1.5rem 1.625rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-left: 2px solid var(--color-accent);
		border-radius: var(--radius-card);
		text-decoration: none;
		color: inherit;
		box-shadow: var(--shadow-card);
		transition:
			border-color var(--dur-ui) var(--ease-out),
			box-shadow var(--dur-ui) var(--ease-out),
			transform var(--dur-ui) var(--ease-out);
	}

	/*
	 * 可点的卡片要有抬起反馈。只做 1px 位移 + 阴影加深，不做 scale——
	 * 缩放会让卡片里的文字在动画过程中发虚。
	 */
	.card:hover {
		box-shadow: var(--shadow-lift);
		transform: translateY(-1px);
	}

	a.card:hover {
		border-color: var(--color-accent);
		transform: translateY(-2px);
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.num {
		font-family: var(--font-mono);
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-faint);
	}

	.tag {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		padding: 0.1875rem 0.5rem;
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		color: var(--color-accent);
	}

	.state {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.75rem;
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
		font-size: 1.375rem;
		line-height: 1.25;
	}

	.summary {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.facts {
		margin: 0.25rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.facts li {
		font-size: 0.75rem;
		padding: 0.1875rem 0.5rem;
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
		margin-top: 0.375rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent);
	}

	.page-foot {
		display: flex;
		gap: 1.5rem;
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 1.5rem;
		font-size: 0.9375rem;
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
</style>
