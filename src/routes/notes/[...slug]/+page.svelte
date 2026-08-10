<script lang="ts">
	/**
	 * 单篇笔记阅读页。
	 *
	 * 客户端渲染（`ssr = false`，见 +page.ts）：markdown 正文在浏览器里
	 * fetch 后渲染，构建期不预渲染 168 篇。代价是这个页面对搜索引擎不可见，
	 * 但 /notes 学习路径页是预渲染的，SEO 入口在那边。
	 *
	 * 公式和 mermaid 严格按需加载：只有 manifest 标记了 hasMath / hasMermaid
	 * 的篇目才会拉 KaTeX / mermaid（两者都很大）。这是 AGENTS.md 硬约定 #12。
	 */
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		detectFeatures,
		renderMarkdown,
		renderMath,
		renderMermaidBlocks,
		type TocEntry
	} from '$lib/notes/render';
	import type { NoteEntry, NotesGradable, NotesManifest, NotesQuiz } from '$lib/notes/types';
	import { notesProgress } from '$lib/storage/notes-progress.svelte';
	import { progress } from '$lib/storage/progress.svelte';
	import { levelForNote } from '$lib/curriculum/mapping';
	import { getLevel } from '$lib/levels/registry';
	import QuizCard from '$lib/components/QuizCard.svelte';
	import type { ChoiceQuestion } from '$lib/quiz/types';

	const slug = $derived(decodeURIComponent(page.params.slug ?? ''));

	/**
	 * 这篇笔记对应的关卡。
	 *
	 * 从 registry 静态取，不需要 fetch——映射表和关卡定义都是 TS 模块。
	 * 没有对应关卡时为 undefined，相关区块整块不渲染。
	 */
	const relatedLevel = $derived(getLevel(levelForNote(slug) ?? ''));

	let html = $state('');
	let toc = $state<TocEntry[]>([]);
	let meta = $state<NoteEntry | null>(null);
	let neighbours = $state<{ prev: NoteEntry | null; next: NoteEntry | null }>({
		prev: null,
		next: null
	});
	let quizItems = $state<string[]>([]);
	/**
	 * Tier A 可判定题。
	 *
	 * 与上面的 quizItems（开放题、纯展示）是两回事：这些走 judge() 判定，
	 * 进度写进和关卡题完全相同的间隔重复存储。
	 */
	let gradable = $state<ChoiceQuestion[]>([]);
	let gradableIndex = $state(0);
	let loadError = $state('');
	let loading = $state(true);
	let ready = $state(false);

	/** 正文容器，公式与图表渲染需要真实 DOM */
	let articleEl = $state<HTMLElement | null>(null);
	/** 阅读进度百分比 */
	let progressPct = $state(0);

	const isRead = $derived(ready && notesProgress.read.has(slug));

	onMount(() => {
		notesProgress.load();
		progress.load();
		ready = true;

		void loadNote();

		const onScroll = () => {
			const el = document.documentElement;
			const total = el.scrollHeight - el.clientHeight;
			progressPct = total > 0 ? Math.min(100, (el.scrollTop / total) * 100) : 0;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
		return () => window.removeEventListener('scroll', onScroll);
	});

	async function loadNote() {
		loading = true;
		loadError = '';
		html = '';
		toc = [];

		try {
			// manifest 用来取元数据和上下篇；正文单独 fetch
			const [mdRes, manifestRes, quizRes, gradableRes] = await Promise.all([
				fetch(`${base}/notes/${slug}.md`),
				fetch(`${base}/notes/manifest.json`),
				fetch(`${base}/notes/quiz.json`),
				fetch(`${base}/notes/gradable.json`)
			]);

			if (!mdRes.ok) throw new Error(`找不到这篇笔记（HTTP ${mdRes.status}）`);
			const markdown = await mdRes.text();

			if (manifestRes.ok) {
				const manifest: NotesManifest = await manifestRes.json();
				const flat = manifest.modules.flatMap((m) => m.sections.flatMap((s) => s.notes));
				const idx = flat.findIndex((n) => n.slug === slug);
				meta = idx >= 0 ? flat[idx] : null;
				neighbours = {
					prev: idx > 0 ? flat[idx - 1] : null,
					next: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null
				};
			}

			if (quizRes.ok) {
				const quiz: NotesQuiz = await quizRes.json();
				quizItems = quiz.items[slug] ?? [];
			}

			// gradable.json 缺失是合法状态（笔记源仓库不存在时写的是空产物），
			// 解析失败也只是这一块不显示，不影响正文
			if (gradableRes.ok) {
				try {
					const data: NotesGradable = await gradableRes.json();
					gradable = data.items?.[slug] ?? [];
					gradableIndex = 0;
				} catch {
					gradable = [];
				}
			}

			const rendered = renderMarkdown(markdown);
			html = rendered.html;
			toc = rendered.toc;
			loading = false;

			// 等 DOM 更新后再渲染公式和图表。
			// manifest 缺失时退回启发式检测，避免漏渲染。
			const features = meta
				? { hasMath: meta.hasMath, hasMermaid: meta.hasMermaid }
				: detectFeatures(markdown);

			await Promise.resolve();
			requestAnimationFrame(() => {
				void (async () => {
					if (!articleEl) return;
					if (features.hasMath) await renderMath(articleEl);
					if (features.hasMermaid) await renderMermaidBlocks(articleEl);
				})();
			});
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
			loading = false;
		}
	}

	function markRead() {
		notesProgress.markRead(slug);
	}

	/** 可判定题的当前一题 */
	const currentGradable = $derived(
		gradableIndex < gradable.length ? gradable[gradableIndex] : undefined
	);

	/**
	 * 写进全站统一的进度存储。
	 *
	 * 题目 id 带 `note:` 前缀（见 scripts/lib/extract-quiz.mjs），
	 * 与关卡题共用一个命名空间但不会撞车，因此可以直接复用 progress.record，
	 * 间隔重复调度对两类题目完全一致。
	 */
	function handleGradableResolved(correct: boolean) {
		const q = currentGradable;
		if (q) progress.record(q.id, correct);
	}

	function nextGradable() {
		gradableIndex += 1;
	}

	function restartGradable() {
		gradableIndex = 0;
	}
</script>

<svelte:head>
	<title>{meta?.title ?? '笔记'} · AI Engineering Lab</title>
	<!-- 客户端渲染的页面不参与索引，避免抓取器拿到空壳 -->
	<meta name="robots" content="noindex" />
</svelte:head>

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

	{#if loading}
		<p class="placeholder" data-testid="note-loading">正在载入正文…</p>
	{:else if loadError}
		<div class="error-box" data-testid="note-error">
			<p class="error-title">载入失败</p>
			<p>{loadError}</p>
			<p class="dim">
				笔记正文由 <code>scripts/sync-notes.mjs</code> 从笔记仓库同步。 如果你是本地开发且没有那个仓库，这里为空是正常的。
			</p>
			<a class="btn-ghost" href={resolve('/notes')}>返回笔记库</a>
		</div>
	{:else}
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
				{@html html}
			</article>
		</div>

		{#if gradable.length > 0}
			<!--
				Tier A 可判定题。QuizCard 刻意不自我重置，换题必须靠 {#key}——
				否则会残留上一题的输入、判定结果和错误次数（AGENTS.md 硬约定 #3）。
			-->
			<section class="gradable" data-testid="note-gradable">
				<div class="gradable-head">
					<h2>自测：{gradable.length} 道可判定题</h2>
					{#if currentGradable}
						<span class="gradable-counter" data-testid="note-gradable-counter">
							第 {gradableIndex + 1} / {gradable.length} 题
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
				{:else}
					<div class="gradable-done" data-testid="note-gradable-done">
						<p class="gradable-done-title">这篇的可判定题做完了</p>
						<button class="btn-ghost" onclick={restartGradable}>再练一遍</button>
					</div>
				{/if}
			</section>
		{/if}

		{#if quizItems.length > 0}
			<section class="self-check" data-testid="note-quiz">
				<h2>读完你应该能回答</h2>
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
					{#each quizItems as q (q)}
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
				{#if neighbours.prev}
					<a href={resolve('/notes/[...slug]', { slug: neighbours.prev.slug })} rel="prev"
						>← {neighbours.prev.title}</a
					>
				{/if}
				{#if neighbours.next}
					<a href={resolve('/notes/[...slug]', { slug: neighbours.next.slug })} rel="next"
						>{neighbours.next.title} →</a
					>
				{/if}
			</div>
		</footer>
	{/if}
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

	.placeholder {
		margin: 0;
		color: oklch(0.62 0.01 260);
	}

	.error-box {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-warn);
		border-radius: 14px;
		padding: 1.5rem 1.75rem;
		display: grid;
		gap: 0.625rem;
		justify-items: start;
		font-size: 0.9375rem;
		line-height: 1.7;
	}

	.error-box p {
		margin: 0;
	}

	.error-title {
		font-weight: 600;
		color: var(--color-warn);
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
