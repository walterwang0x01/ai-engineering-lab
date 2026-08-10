<script lang="ts">
	/**
	 * 单篇笔记阅读页。
	 *
	 * **服务端渲染 + 构建期全量预渲染**（见 +page.ts 的说明）：正文 HTML 由
	 * load 在构建期渲染好，组件只负责交互。改版前是 `ssr = false` 的纯客户端
	 * 渲染，代价是深层 URL 返回 404 状态码、168 篇对搜索引擎不存在、
	 * 首屏要等一次 fetch 瀑布——三个问题都是线上实测抓到的。
	 *
	 * 公式和 mermaid 仍然严格按需、在 onMount 里加载：这两个库很大，
	 * 而且需要真实 DOM，构建期做不了（AGENTS.md 硬约定 #12）。
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import QuizCard from '$lib/components/QuizCard.svelte';
	import { renderMath, renderMermaidBlocks } from '$lib/notes/render';
	import { notesProgress } from '$lib/storage/notes-progress.svelte';
	import { progress } from '$lib/storage/progress.svelte';
	import { levelForNote } from '$lib/curriculum/mapping';
	import { getLevel } from '$lib/levels/registry';
	import { INTERVALS_DAYS, buildDueDeck, summarizeMastery } from '$lib/quiz/schedule';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const slug = $derived(data.slug);
	const meta = $derived(data.meta);
	const toc = $derived(data.toc);
	const gradable = $derived(data.gradable);
	const openQuestions = $derived(data.openQuestions);

	/** 这篇笔记对应的关卡。从 registry 静态取，不需要 fetch */
	const relatedLevel = $derived(getLevel(levelForNote(slug) ?? ''));

	let gradableIndex = $state(0);
	/**
	 * 本篇要练的题序列。
	 *
	 * 必须走 buildDueDeck 而不是顺序遍历全部题目：改版前刷新页面后，
	 * 已经答对的题会回到未答状态重新出现一遍。进度其实存着
	 * （localStorage 里有 box 和 dueAt，首页也显示「1 道在学」），
	 * 但题目界面不认——零上下文复查的原话是「作为新人我的结论会是'白做了'，
	 * 而不是'这是间隔重复'」。关卡页一直是用 buildDueDeck 的，两处行为不一致。
	 */
	let deck = $state<string[]>([]);
	let ready = $state(false);
	/** 正文容器，公式与图表渲染需要真实 DOM */
	let articleEl = $state<HTMLElement | null>(null);
	/** 阅读进度百分比 */
	let progressPct = $state(0);

	const isRead = $derived(ready && notesProgress.read.has(slug));

	/** 这篇的可判定题掌握度，用于顶部标签显示「2 / 3 已掌握」 */
	const mastery = $derived(
		summarizeMastery(
			gradable.map((q) => q.id),
			progress.scheduleView
		)
	);

	onMount(() => {
		notesProgress.load();
		progress.load();
		ready = true;
		rebuildDeck();

		const onScroll = () => {
			const el = document.documentElement;
			const total = el.scrollHeight - el.clientHeight;
			progressPct = total > 0 ? Math.min(100, (el.scrollTop / total) * 100) : 0;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
		return () => window.removeEventListener('scroll', onScroll);
	});

	/**
	 * 公式与图表在 hydration 之后渲染。
	 *
	 * 用 $effect 而不是 onMount：客户端路由在两篇笔记之间跳转时组件会复用，
	 * onMount 只跑一次，第二篇的公式就不会被渲染。
	 */
	$effect(() => {
		const el = articleEl;
		const needMath = data.hasMath;
		const needMermaid = data.hasMermaid;
		if (!el) return;
		void (async () => {
			if (needMath) await renderMath(el);
			if (needMermaid) await renderMermaidBlocks(el);
		})();
	});

	function markRead() {
		notesProgress.markRead(slug);
	}

	/** 按到期时间排队。新题优先，其次是已到期的旧题 */
	function rebuildDeck() {
		const ids = gradable.map((q) => q.id);
		deck = buildDueDeck(ids, progress.scheduleView, Date.now(), ids.length);
		gradableIndex = 0;
	}

	const currentGradable = $derived(
		gradableIndex < deck.length ? gradable.find((q) => q.id === deck[gradableIndex]) : undefined
	);

	/** 本轮排队为空（全部答过且未到期）时，告诉用户下次复习大概在什么时候 */
	const nextReviewDays = $derived.by(() => {
		const boxes = gradable
			.map((q) => progress.get(q.id)?.box ?? 0)
			.filter((b) => b > 0 && b < INTERVALS_DAYS.length);
		if (boxes.length === 0) return 0;
		return Math.min(...boxes.map((b) => INTERVALS_DAYS[b]));
	});

	/**
	 * 写进全站统一的进度存储。题目 id 带 `note:` 前缀，
	 * 与关卡题共用命名空间但不撞车，所以可以直接复用 progress.record。
	 */
	function handleGradableResolved(correct: boolean) {
		const q = currentGradable;
		if (q) progress.record(q.id, correct);
	}

	function nextGradable() {
		gradableIndex += 1;
	}

	/** 不等到期，现在就把这篇的题全部再练一遍 */
	function practiseAll() {
		deck = gradable.map((q) => q.id);
		gradableIndex = 0;
	}

	/** 摘要：取正文前若干字做 description，避免 168 篇共用一句话 */
	const description = $derived(
		`${meta?.title ?? '笔记'}——AI 工程笔记，约 ${meta?.minutes ?? 0} 分钟读完` +
			(gradable.length > 0 ? `，含 ${gradable.length} 道可判定自测题。` : '。')
	);
</script>

<Seo title={`${meta?.title ?? '笔记'} · AI Engineering Lab`} {description} ogImage="home.png" />

<!-- 顶部阅读进度条。纯装饰，aria-hidden 避免屏幕阅读器朗读一个无意义的数字 -->
<div class="progress-rail" aria-hidden="true">
	<div class="progress-fill" style="width: {progressPct}%"></div>
</div>

<main>
	<nav class="crumbs">
		<a href={resolve('/notes')}>← 笔记库</a>
		{#if meta}
			<span class="crumb-meta" data-testid="note-meta">
				{meta.wordCount.toLocaleString()} 字 · 约 {meta.minutes} 分钟
			</span>
		{/if}
	</nav>

	{#if gradable.length > 0}
		<!--
			题目区在整篇最底部，在「推荐视频资源 / 系统课程与教材」这些附录之后。
			零上下文复查者的原话：「我滚到延伸阅读的时候已经认定笔记结束了，
			正常人会在这里关掉页面」——全站唯一的 12 道笔记题就藏在那后面。
		-->
		<a class="jump-quiz" href="#gradable" data-testid="jump-to-gradable">
			本篇有 {gradable.length} 道可判定题{#if ready && mastery.mastered > 0}（已掌握 {mastery.mastered}）{/if}·
			直接去做 ↓
		</a>
	{/if}

	<div class="layout">
		{#if toc.length > 2}
			<aside class="toc" aria-label="目录">
				<p class="toc-title">目录</p>
				<ul>
					{#each toc as entry (entry.id)}
						<li style="--depth: {entry.level - 2}">
							<a href="#{entry.id}">{entry.text}</a>
						</li>
					{/each}
				</ul>
			</aside>
		{/if}

		<article class="note-body" bind:this={articleEl} data-testid="note-body">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- 内容来自本仓库同步的自有笔记，非用户输入 -->
			{@html data.html}
		</article>
	</div>

	{#if gradable.length > 0}
		<!--
				Tier A 可判定题。QuizCard 刻意不自我重置，换题必须靠 {#key}——
				否则会残留上一题的输入、判定结果和错误次数（AGENTS.md 硬约定 #3）。
			-->
		<section class="gradable" id="gradable" data-testid="note-gradable">
			<div class="gradable-head">
				<h2>动手自测：{gradable.length} 道题，程序判对错</h2>
				{#if ready && mastery.mastered > 0}
					<span class="gradable-mastery" data-testid="note-gradable-mastery">
						{mastery.mastered} / {mastery.total} 已掌握
					</span>
				{/if}
				{#if currentGradable}
					<span class="gradable-counter" data-testid="note-gradable-counter">
						第 {gradableIndex + 1} / {deck.length} 题
					</span>
				{/if}
			</div>
			<p class="dim">
				这些题由程序判定对错，答错会给出针对那个选项的解释。 答对的题按 1、3、7、16、35
				天排复习，与关卡题共用同一套进度。
			</p>

			{#if currentGradable}
				{#key currentGradable.id}
					<QuizCard
						question={currentGradable}
						onResolved={handleGradableResolved}
						onNext={nextGradable}
					/>
				{/key}
			{:else if ready}
				<!--
					排队为空有两种原因，必须说清是哪一种：
					刚做完一轮，还是全部答过、正等着到期复习。
					改版前这里只有一句「做完了」，而刷新后题目会重新出现，
					用户会以为进度丢了。
				-->
				<div class="gradable-done" data-testid="note-gradable-done">
					{#if mastery.total > 0 && mastery.untouched === 0}
						<p class="gradable-done-title">这篇的 {mastery.total} 道题都答过了</p>
						<p class="gradable-done-body">
							{#if nextReviewDays > 0}
								按间隔重复，最早的一道会在约 {nextReviewDays} 天后重新排进队列。答对的题不会立刻再问你——这是刻意的，隔一段时间再检索才能看出是真记住还是刚看过。
							{:else}
								答错的题会立刻回到队列。
							{/if}
						</p>
					{:else}
						<p class="gradable-done-title">这一轮做完了</p>
					{/if}
					<button class="btn-ghost" onclick={practiseAll}>不等了，现在就练一遍</button>
				</div>
			{/if}
		</section>
	{/if}

	{#if openQuestions.length > 0}
		<section class="self-check" data-testid="note-quiz">
			<h2>开放式回顾：讲给自己听</h2>
			<p class="dim">
				这些是开放题，没有自动判定。答不上就是需要重读的信号——
				{#if relatedLevel}
					想要能判定对错的题目，去<a href={resolve('/[levelId]', { levelId: relatedLevel.id })}
						>「{relatedLevel.title}」</a
					>。
				{:else}
					想要能判定对错的题目，去<a href={resolve('/')}>关卡</a>。
				{/if}
			</p>
			<ol>
				{#each openQuestions as q (q)}
					<li>{q}</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if relatedLevel}
		<!--
				笔记 → 关卡的反向链接。
				没有它，读完笔记的人不知道站里有配套的可判定练习，
				而关卡页那边也找不回背景笔记 —— 两侧各自成孤岛。
			-->
		<section class="to-level" data-testid="note-to-level">
			<p class="to-level-eyebrow">{relatedLevel.card.tag} · 配套关卡</p>
			<h2>{relatedLevel.title}</h2>
			<p class="to-level-body">{relatedLevel.card.summary}</p>
			<a
				class="to-level-cta"
				href={resolve('/[levelId]', { levelId: relatedLevel.id })}
				data-testid="note-level-link"
			>
				去做这一关的可判定题 →
			</a>
		</section>
	{/if}

	<footer class="foot">
		<button
			class="btn-read"
			class:done={isRead}
			onclick={markRead}
			disabled={isRead}
			data-testid="mark-read"
		>
			{isRead ? '✓ 已标记为读完' : '标记为读完'}
		</button>

		<!-- resolve 必须内联：ESLint 的 no-navigation-without-resolve
			     只认 href 上直接的 resolve(...) 调用，包一层函数就检测不到。
			     带参形式也让 SvelteKit 负责 slug 的 URL 编码。 -->
		<div class="neighbours">
			{#if data.prev}
				<a href={resolve('/notes/[...slug]', { slug: data.prev.slug })} rel="prev"
					>← {data.prev.title}</a
				>
			{/if}
			{#if data.next}
				<a href={resolve('/notes/[...slug]', { slug: data.next.slug })} rel="next"
					>{data.next.title} →</a
				>
			{/if}
		</div>
	</footer>
</main>

<style>
	.progress-rail {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--color-surface-sunken);
		z-index: 10;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 80ms linear;
	}

	main {
		max-width: 62rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
		display: grid;
		gap: 1.75rem;
	}

	.crumbs {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		font-size: 0.875rem;
	}

	.crumbs a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--color-accent);
		text-decoration: none;
	}

	.crumbs a:hover {
		text-decoration: underline;
	}

	.crumb-meta {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: oklch(0.62 0.01 260);
	}

	.layout {
		display: grid;
		gap: 2rem;
		align-items: start;
	}

	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 14rem;
		}

		.toc {
			grid-column: 2;
			grid-row: 1;
			position: sticky;
			top: 2rem;
			max-height: calc(100dvh - 4rem);
			overflow-y: auto;
		}

		.note-body {
			grid-column: 1;
			grid-row: 1;
		}
	}

	.toc {
		font-size: 0.8125rem;
		border-left: 1px solid var(--color-border-subtle);
		padding-left: 0.875rem;
	}

	.toc-title {
		margin: 0 0 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.62 0.01 260);
	}

	.toc ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.375rem;
	}

	.toc li {
		padding-left: calc(var(--depth) * 0.75rem);
	}

	.toc a {
		color: oklch(0.72 0.01 260);
		text-decoration: none;
		line-height: 1.5;
	}

	.toc a:hover {
		color: var(--color-accent);
	}

	/* 正文样式：动态插入的 HTML 需要 :global */
	.note-body {
		min-width: 0;
		font-size: 1rem;
		line-height: 1.8;
	}

	.note-body :global(h1) {
		font-size: clamp(1.625rem, 4vw, 2.125rem);
		line-height: 1.25;
		margin: 0 0 1.25rem;
	}

	.note-body :global(h2) {
		font-size: 1.375rem;
		margin: 2.5rem 0 0.875rem;
		padding-bottom: 0.375rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.note-body :global(h3) {
		font-size: 1.125rem;
		margin: 2rem 0 0.75rem;
	}

	.note-body :global(h4) {
		font-size: 1rem;
		margin: 1.5rem 0 0.5rem;
		color: oklch(0.82 0.008 260);
	}

	.note-body :global(p),
	.note-body :global(li) {
		color: oklch(0.84 0.006 260);
	}

	.note-body :global(a) {
		color: var(--color-accent);
	}

	.note-body :global(pre) {
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		padding: 0.875rem 1rem;
		overflow-x: auto;
		font-size: 0.8125rem;
		line-height: 1.65;
	}

	.note-body :global(code) {
		font-family: var(--font-mono);
	}

	.note-body :global(:not(pre) > code) {
		background: var(--color-surface-sunken);
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		font-size: 0.875em;
	}

	.note-body :global(blockquote) {
		margin: 1.25rem 0;
		padding: 0.75rem 1rem;
		border-left: 2px solid var(--color-accent);
		background: var(--color-surface-sunken);
		border-radius: 0 8px 8px 0;
	}

	.note-body :global(blockquote p) {
		margin: 0.375rem 0;
	}

	.note-body :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
		margin: 1.25rem 0;
		display: block;
		overflow-x: auto;
	}

	.note-body :global(th),
	.note-body :global(td) {
		border: 1px solid var(--color-border-subtle);
		padding: 0.5rem 0.75rem;
		text-align: left;
	}

	.note-body :global(th) {
		background: var(--color-surface-sunken);
	}

	.note-body :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: 8px;
	}

	.note-body :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-border-subtle);
		margin: 2rem 0;
	}

	.self-check {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		padding: 1.5rem 1.75rem;
	}

	.to-level {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-accent-dim);
		border-radius: 14px;
		padding: 1.5rem 1.75rem;
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}

	.jump-quiz {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.875rem;
		border-radius: 9px;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-accent-dim);
		color: var(--color-accent);
		font-size: 0.875rem;
		text-decoration: none;
		transition: border-color 140ms ease;
	}

	.jump-quiz:hover {
		border-color: var(--color-accent);
	}

	.gradable {
		display: grid;
		gap: 0.875rem;
	}

	.gradable-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.gradable-head h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.gradable-mastery {
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: var(--color-ok);
	}

	.gradable-counter {
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: oklch(0.66 0.01 260);
	}

	.gradable-done {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		padding: 1.5rem 1.75rem;
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}

	.gradable-done-body {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.75;
		color: oklch(0.74 0.01 260);
	}

	.gradable-done-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-ok);
	}

	.btn-ghost {
		font: inherit;
		font-size: 0.9375rem;
		padding: 0.5rem 1rem;
		background: transparent;
		color: var(--color-accent);
		border: 1px solid var(--color-border-subtle);
		border-radius: 8px;
		cursor: pointer;
		transition: border-color 140ms ease;
	}

	.btn-ghost:hover {
		border-color: var(--color-accent);
	}

	.to-level-eyebrow {
		margin: 0;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--color-accent);
	}

	.to-level h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.to-level-body {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: oklch(0.76 0.008 260);
	}

	.to-level-cta {
		margin-top: 0.25rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent);
		text-decoration: none;
	}

	.to-level-cta:hover {
		text-decoration: underline;
	}

	.self-check h2 {
		margin: 0 0 0.5rem;
		font-size: 1.125rem;
	}

	.self-check ol {
		margin: 0.875rem 0 0;
		padding-left: 1.375rem;
		display: grid;
		gap: 0.625rem;
		font-size: 0.9375rem;
		line-height: 1.7;
	}

	.self-check a {
		color: var(--color-accent);
	}

	.dim {
		font-size: 0.875rem;
		color: oklch(0.64 0.01 260);
		line-height: 1.7;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 1.5rem;
	}

	.neighbours {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
		font-size: 0.875rem;
	}

	.neighbours a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--color-accent);
		text-decoration: none;
		max-width: 18rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.neighbours a:hover {
		text-decoration: underline;
	}

	.btn-read,
	.btn-ghost {
		font: inherit;
		font-size: 0.9375rem;
		padding: 0.5rem 1.0625rem;
		border-radius: 8px;
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: none;
	}

	.btn-read:not(:disabled):hover {
		border-color: var(--color-accent);
	}

	.btn-read.done {
		color: var(--color-ok);
		border-color: var(--color-ok);
		cursor: default;
	}
</style>
