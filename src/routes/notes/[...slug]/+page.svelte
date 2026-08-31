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
	import RunnableCode from '$lib/components/RunnableCode.svelte';
	import NoteWidgets from '$lib/components/NoteWidgets.svelte';
	import { renderMath, renderMermaidBlocks } from '$lib/notes/render';
	import { widgetId, widgetsForNote } from '$lib/notes/widgets';
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
	const noteWidgets = $derived(widgetsForNote(slug));
	const firstInteractionId = $derived(noteWidgets.length > 0 ? widgetId(noteWidgets[0]) : null);

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
		{#if relatedLevel}
			<!-- 关卡 → 笔记原来是单向的：读完想回去做题只能按浏览器后退 -->
			<a
				class="crumb-level"
				href={resolve('/[levelId]', { levelId: relatedLevel.id })}
				data-testid="crumb-to-level"
			>
				← 回到「{relatedLevel.title}」
			</a>
		{/if}
		{#if meta}
			<span class="crumb-meta" data-testid="note-meta">
				{meta.wordCount.toLocaleString()} 字 · 约 {meta.minutes} 分钟
			</span>
		{/if}
	</nav>

	<div class="jump-links">
		<!--
			交互本体在 hydration 后才被搬进正文，SSR 阶段不存在真实 DOM id。
			先输出稳定占位锚点，供 SvelteKit 预渲染爬虫验证链接；客户端挂载后
			NoteWidgets 会把 id 转移到正文里的真实实验位置。不要用 handleMissingId
			忽略，否则真正拼错的 id 也会静默通过构建。
		-->
		{#each noteWidgets as widget (widgetId(widget))}
			<span class="interaction-anchor" id={`interaction-${widgetId(widget)}`} aria-hidden="true"
			></span>
		{/each}
		{#if firstInteractionId}
			<a
				class="jump-quiz"
				href={`#interaction-${firstInteractionId}`}
				data-testid="jump-to-interaction"
			>
				本篇有 {noteWidgets.length} 个可调实验 · 直接去动手 ↓
			</a>
		{/if}
		{#if gradable.length > 0}
			<!--
				题目区在整篇最底部，在「推荐视频资源 / 系统课程与教材」这些附录之后。
				零上下文复查者的原话：「我滚到延伸阅读的时候已经认定笔记结束了，
				正常人会在这里关掉页面」——全站唯一的笔记题就藏在那后面。
			-->
			<a class="jump-quiz" href="#gradable" data-testid="jump-to-gradable">
				本篇有 {gradable.length} 道可判定题{#if ready && mastery.mastered > 0}（已掌握 {mastery.mastered}）{/if}·
				直接去做 ↓
			</a>
		{/if}
	</div>

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
			<!--
				正文里的 python 代码块升级成可运行，以及把可操纵部件插进对应小节。
				两者都靠查询已渲染的 DOM 找锚点，所以必须等 articleEl 存在后再挂载。
			-->
			{#if articleEl}
				<RunnableCode container={articleEl} />
				{#key data.slug}
					<NoteWidgets container={articleEl} slug={data.slug} />
				{/key}
			{/if}
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
		height: 3px;
		background: var(--color-track);
		z-index: 10;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		/* 跟随滚动，必须比 --dur-verdict 更快 —— 这条是直接映射手指动作的，
		   任何可感知的延迟都会让它看起来在「追」滚动条 */
		transition: width 80ms linear;
	}

	main {
		max-width: 62rem;
		margin: 0 auto;
		padding: var(--space-7) var(--space-5) var(--space-8);
		display: grid;
		gap: var(--space-6);
	}

	.crumbs {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		font-size: var(--fs-sm);
	}

	.crumb-level {
		color: var(--color-accent);
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
		font-size: var(--fs-sm);
		color: var(--color-text-faint);
	}

	.layout {
		display: grid;
		gap: var(--space-6);
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
			top: var(--space-6);
			max-height: calc(100dvh - 4rem);
			overflow-y: auto;
		}

		.note-body {
			grid-column: 1;
			grid-row: 1;
		}
	}

	.toc {
		font-size: var(--fs-sm);
		border-left: 1px solid var(--color-border-subtle);
		padding-left: var(--space-3);
	}

	/*
	 * 目录标题去掉 uppercase + letter-spacing：对「目录」两个字做不了任何事
	 * （中文没有大小写可转），字距只会把它们推散。与首页、关卡页、
	 * 笔记索引页同源修正。
	 */
	.toc-title {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.toc ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}

	.toc li {
		padding-left: calc(var(--depth) * 0.75rem);
	}

	.toc a {
		color: var(--color-text-muted);
		text-decoration: none;
		line-height: 1.5;
	}

	.toc a:hover {
		color: var(--color-accent);
	}

	/* 正文样式：动态插入的 HTML 需要 :global */
	.note-body {
		min-width: 0;
		font-size: var(--fs-md);
		line-height: 1.8;
	}

	/*
	 * 标题**必须显式给 text-strong**。
	 *
	 * 原来 h1/h2/h3 一个 color 都没声明（只有 h4 有，而它给的是正文色），
	 * 于是三级标题全部继承 html 的 --color-text —— **168 篇内容的标题
	 * 用的都不是最重的墨色**。五档灰里最强的那一档在整个阅读界面从不出场，
	 * 长文于是读起来是一片均匀的灰，扫不出层级。
	 * 首页 h1 是同一个 bug，但这里的影响面是全部笔记正文。
	 */
	.note-body :global(h1) {
		font-size: var(--fs-xl);
		line-height: 1.2;
		letter-spacing: -0.02em;
		color: var(--color-text-strong);
		margin: 0 0 var(--space-5);
	}

	.note-body :global(h2) {
		font-size: var(--fs-lg);
		line-height: 1.3;
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
		margin: var(--space-7) 0 var(--space-3);
		padding-bottom: var(--space-1);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.note-body :global(h3) {
		font-size: var(--fs-md);
		line-height: 1.4;
		color: var(--color-text-strong);
		margin: var(--space-6) 0 var(--space-2);
	}

	.note-body :global(h4) {
		font-size: var(--fs-base);
		font-weight: 600;
		color: var(--color-text-strong);
		margin: var(--space-5) 0 var(--space-2);
	}

	.note-body :global(p),
	.note-body :global(li) {
		color: var(--color-text);
	}

	/* 强调文字用最重的墨色，否则 <strong> 在正文灰里几乎读不出加粗 */
	.note-body :global(strong) {
		color: var(--color-text-strong);
	}

	.note-body :global(a) {
		color: var(--color-accent);
	}

	.note-body :global(pre) {
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		padding: var(--space-4);
		margin: var(--space-5) 0;
		overflow-x: auto;
		font-size: var(--fs-sm);
		line-height: 1.65;
	}

	.note-body :global(code) {
		font-family: var(--font-mono);
	}

	/*
	 * 语法高亮。
	 *
	 * `render.ts` 一直在输出 hljs 类名，但站内从未引入过任何 hljs 主题 ——
	 * 167/168 篇笔记的代码块因此全部以正文色单色渲染。这里不引入 highlight.js
	 * 自带的 CSS 主题，因为那些主题每个都带一整套硬编码取值，会同时违反
	 * 「颜色只写在 layout.css」和「两套主题成对维护」两条约束。
	 *
	 * 产物里实际出现 17 个类，按频次归并到 5 档（括号内是出现次数）：
	 *
	 *   string   (9538)                                    → --color-code-string
	 *   keyword  (6865) + literal (476)                    → --color-code-keyword
	 *   number   (5546)                                    → --color-code-number
	 *   built_in (3851) + title (2162) + type + function   → --color-code-fn
	 *   comment  (3009)                                    → --color-code-comment
	 *
	 * 余下的 subst / variable / params / punctuation / attr / property / meta / regexp
	 * 刻意不上色，继承正文色：每个 token 都染色等于没有重点。
	 */
	.note-body :global(.hljs-string) {
		color: var(--color-code-string);
	}

	.note-body :global(.hljs-keyword),
	.note-body :global(.hljs-literal) {
		color: var(--color-code-keyword);
	}

	.note-body :global(.hljs-number) {
		color: var(--color-code-number);
	}

	.note-body :global(.hljs-built_in),
	.note-body :global(.hljs-title),
	.note-body :global(.hljs-type),
	.note-body :global(.hljs-function) {
		color: var(--color-code-fn);
	}

	.note-body :global(.hljs-comment) {
		color: var(--color-code-comment);
	}

	.note-body :global(:not(pre) > code) {
		background: var(--color-surface-sunken);
		padding: 0.125rem var(--space-1);
		border-radius: var(--radius-control);
		/* 用 em 而不是 token：行内代码要跟着所在文字的字号缩放，
		   出现在 h2 里和出现在正文里应该是不同的绝对大小 */
		font-size: 0.875em;
	}

	.note-body :global(blockquote) {
		margin: var(--space-5) 0;
		padding: var(--space-3) var(--space-4);
		border-left: 2px solid var(--color-accent);
		background: var(--color-surface-sunken);
		border-radius: 0 var(--radius-control) var(--radius-control) 0;
	}

	.note-body :global(blockquote p) {
		margin: var(--space-1) 0;
	}

	.note-body :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-sm);
		margin: var(--space-5) 0;
		display: block;
		overflow-x: auto;
	}

	.note-body :global(th),
	.note-body :global(td) {
		border: 1px solid var(--color-border-subtle);
		padding: var(--space-2) var(--space-3);
		text-align: left;
	}

	.note-body :global(th) {
		background: var(--color-surface-sunken);
		color: var(--color-text-strong);
		font-weight: 600;
	}

	.note-body :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-control);
	}

	.note-body :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-border-subtle);
		margin: var(--space-6) 0;
	}

	.self-check {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		padding: var(--space-5);
	}

	.to-level {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		/* 左侧强调条：这是读完之后唯一的「下一步」出口，需要不依赖字号的权重 */
		border-left: 3px solid var(--color-accent);
		border-radius: var(--radius-card);
		padding: var(--space-5);
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	.jump-links {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/*
	 * SSR 阶段给预渲染爬虫和无 JS 导航提供真实锚点；客户端会把 id 转移到正文实验。
	 * 不用 display:none：隐藏元素没有可滚动位置。1px 视觉隐藏即可。
	 */
	.interaction-anchor {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		pointer-events: none;
	}

	.jump-quiz {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-accent-dim);
		color: var(--color-accent);
		font-size: var(--fs-sm);
		font-weight: 600;
		text-decoration: none;
		transition: border-color var(--dur-ui) var(--ease-out);
	}

	.jump-quiz:hover {
		border-color: var(--color-accent);
	}

	.gradable {
		display: grid;
		gap: var(--space-3);
	}

	.gradable-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.gradable-head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
	}

	.gradable-mastery {
		font-size: var(--fs-sm);
		font-family: var(--font-mono);
		color: var(--color-ok);
	}

	.gradable-counter {
		font-size: var(--fs-sm);
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}

	.gradable-done {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		padding: var(--space-5);
		display: grid;
		gap: var(--space-3);
		justify-items: start;
	}

	.gradable-done-body {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.gradable-done-title {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--color-ok);
	}

	.to-level-eyebrow {
		margin: 0;
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		color: var(--color-accent);
	}

	.to-level h2 {
		margin: 0;
		font-size: var(--fs-lg);
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
	}

	.to-level-body {
		margin: 0;
		font-size: var(--fs-base);
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.to-level-cta {
		margin-top: var(--space-1);
		font-size: var(--fs-base);
		font-weight: 600;
		color: var(--color-accent);
		text-decoration: none;
	}

	.to-level-cta:hover {
		text-decoration: underline;
	}

	.self-check h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-lg);
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
	}

	.self-check ol {
		margin: var(--space-3) 0 0;
		padding-left: var(--space-5);
		display: grid;
		gap: var(--space-2);
		font-size: var(--fs-base);
		line-height: 1.7;
	}

	.self-check a {
		color: var(--color-accent);
	}

	.dim {
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
		line-height: 1.7;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: center;
		justify-content: space-between;
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--space-5);
	}

	.neighbours {
		display: flex;
		gap: var(--space-5);
		flex-wrap: wrap;
		font-size: var(--fs-sm);
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

	/*
	 * 两个幽灵按钮共用一条规则。
	 *
	 * `.btn-ghost` 原来被定义了**两次** —— 一次在 .gradable-done 附近、
	 * 一次在这里，两处给了不同的 padding（1rem vs 1.0625rem）和不同的
	 * border-color 来源，后者更靠后所以静默胜出。关卡页注释里记过同类问题
	 * （`.card:hover` 与 `a.card:hover` 各给一个 translateY），
	 * 症状一样：两条规则对同一件事给出矛盾的值，只有一个生效，
	 * 下一个改动的人会以为自己改的那处失效了。现在只留这一处。
	 *
	 * 无底色的幽灵按钮，边框是它唯一的按钮线索 —— 按 WCAG 1.4.11
	 * 用 border-strong 而不是 border-subtle（后者在浅色下只有 1.9:1，
	 * 按钮会退化成一段带边的蓝字）。
	 */
	.btn-read,
	.btn-ghost {
		font: inherit;
		font-size: var(--fs-base);
		font-weight: 600;
		min-height: 44px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border-strong);
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: none;
		transition: border-color var(--dur-ui) var(--ease-out);
	}

	/* hover 反馈两个按钮都要有。原来 .btn-ghost 的那条藏在被覆盖的重复定义里 */
	.btn-read:not(:disabled):hover,
	.btn-ghost:hover {
		border-color: var(--color-accent);
	}

	.btn-read.done {
		color: var(--color-ok);
		border-color: var(--color-ok);
		cursor: default;
	}
</style>
