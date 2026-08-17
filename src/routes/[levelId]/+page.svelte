<script lang="ts">
	/**
	 * 关卡页统一实现。
	 *
	 * 这个文件替代了原先 kv-cache 和 attention 两个各约 300 行、
	 * 内容一字不差的页面。新增关卡不再需要写页面，只在 registry 加一项。
	 */
	import { onMount } from 'svelte';
	import QuizCard from '$lib/components/QuizCard.svelte';
	import MasteryLegend from '$lib/components/MasteryLegend.svelte';
	import CodeQuestionCard from '$lib/components/CodeQuestionCard.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { buildDueDeck, summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';
	import { notesForLevel } from '$lib/curriculum/mapping';
	import { base, resolve } from '$app/paths';
	import type { NoteEntry, NotesManifest } from '$lib/notes/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const level = $derived(data.level);
	const allIds = $derived(level.questions.map((q) => q.id));
	const codeCount = $derived(level.questions.filter((q) => q.kind === 'code').length);

	let ready = $state(false);
	let deck = $state<string[]>([]);
	let index = $state(0);
	/** 交互组件按需加载，避免所有关卡的可视化都进首屏 */
	let InteractiveComponent = $state<
		Awaited<ReturnType<NonNullable<typeof level.interactive>['load']>>['default'] | null
	>(null);

	/**
	 * 背景笔记。标题要从 manifest 取，所以必须 fetch——
	 * 映射表里只有 slug，把标题也写进映射表会产生第二份真相，
	 * 笔记改标题时这里就会显示过期的旧标题。
	 *
	 * 笔记未同步时保持空数组，整个区块不渲染，页面照常可用。
	 */
	let backgroundNotes = $state<NoteEntry[]>([]);

	// 用 onMount 而非 $effect：deck 只在进入页面时构建一次，
	// 否则每次答题更新 records 都会重建队列、打乱进度
	onMount(() => {
		progress.load();
		deck = buildDueDeck(allIds, progress.scheduleView, Date.now(), allIds.length);
		ready = true;

		const interactive = level.interactive;
		if (interactive) {
			void interactive.load().then((m) => (InteractiveComponent = m.default));
		}

		void loadBackgroundNotes();
	});

	/** 按映射表的顺序取背景笔记的元数据。primary 在前，与映射表一致 */
	async function loadBackgroundNotes() {
		const slugs = notesForLevel(level.id);
		if (slugs.length === 0) return;
		try {
			const res = await fetch(`${base}/notes/manifest.json`);
			if (!res.ok) return;
			const manifest: NotesManifest = await res.json();
			const flat = manifest.modules.flatMap((m) => m.sections.flatMap((s) => s.notes));
			backgroundNotes = slugs
				.map((slug) => flat.find((n) => n.slug === slug))
				.filter((n): n is NoteEntry => n !== undefined);
		} catch {
			// 笔记不可用不影响做题，静默降级
		}
	}

	const current = $derived(
		deck.length > 0 && index < deck.length
			? level.questions.find((q) => q.id === deck[index])
			: undefined
	);

	const mastery = $derived(summarizeMastery(allIds, progress.scheduleView));
	const finished = $derived(ready && deck.length > 0 && index >= deck.length);

	function handleResolved(correct: boolean) {
		const id = deck[index];
		if (id) progress.record(id, correct);
	}

	function next() {
		index += 1;
	}

	/** 重新开始一轮：把全部题目重新排队，不清除掌握度 */
	function restartRound() {
		deck = [...allIds];
		index = 0;
	}

	/**
	 * 背景笔记区的导语。
	 *
	 * 拼成单个字符串而不是在模板里用三元插值：数字前后要留空格（仓库的中英混排习惯），
	 * 而模板里的 `{n} 篇` 前面那个空格会被 Svelte 连同换行一起吃掉，
	 * 线上渲染成「来自这2 篇笔记」——这是实测截图里发现的。
	 */
	const backgroundIntro = $derived(
		backgroundNotes.length === 1
			? '这一关的推导和数据来自这篇笔记。答不上来的时候回去读，比看答案有用。'
			: `这一关的推导和数据来自这 ${backgroundNotes.length} 篇笔记。答不上来的时候回去读，比看答案有用。`
	);
</script>

<Seo title={level.seo.title} description={level.seo.description} ogImage={level.seo.ogImage} />

<main>
	<header class="page-head">
		<p class="eyebrow">{level.eyebrow}</p>
		<h1>{level.title}</h1>
		<p class="lede">{level.lede}</p>
	</header>

	{#if backgroundNotes.length > 0}
		<section class="background" data-testid="level-background">
			<h2 class="bg-title">背景笔记</h2>
			<p class="section-note">{backgroundIntro}</p>
			<ul class="bg-list">
				{#each backgroundNotes as note (note.slug)}
					<li>
						<a
							class="bg-link"
							href={resolve('/notes/[...slug]', { slug: note.slug })}
							data-testid="background-note-link"
						>
							<span>{note.title}</span>
							<span class="bg-meta">{note.minutes} 分钟</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if level.interactive}
		<section class="panel">
			<h2>{level.interactive.heading}</h2>
			<p class="section-note">{level.interactive.note}</p>
			{#if InteractiveComponent}
				<InteractiveComponent />
			{:else}
				<p class="placeholder">正在加载交互演示…</p>
			{/if}
		</section>
	{/if}

	<section class="panel">
		<div class="quiz-head">
			<h2>自测：{allIds.length} 道可判定题</h2>
			{#if ready}
				<div class="stats" aria-label="掌握度统计">
					<span class="stat"><b>{mastery.mastered}</b> 已掌握</span>
					<span class="stat"><b>{mastery.learning}</b> 在学</span>
					<span class="stat"><b>{mastery.untouched}</b> 未做</span>
					{#if mastery.struggling > 0}
						<span class="stat stat-warn"><b>{mastery.struggling}</b> 需重练</span>
					{/if}
					{#if progress.streak > 1}
						<span class="stat stat-streak">🔥 连对 {progress.streak}</span>
					{/if}
				</div>
			{/if}
		</div>

		{#if ready}
			<MasteryLegend compact />
		{/if}

		<p class="section-note">
			每道题都有确定答案，答错会给出针对性的解释。
			{#if codeCount > 0}
				其中 {codeCount} 道是代码题——在浏览器里真跑 Python，用断言判定，改对了才算过。
			{/if}
			答对的题会按间隔重复安排复习——1 天、3 天、7 天、16 天、35 天， 这比一次刷完再也不看的留存率高得多。
		</p>

		{#if !ready}
			<p class="placeholder">载入进度…</p>
		{:else if finished}
			<div class="done">
				<p class="done-title">这一轮做完了</p>
				<p class="done-body">
					本轮最佳连击 {progress.bestStreak}。已掌握 {mastery.mastered} / {allIds.length} 题。
					{#if mastery.mastered < allIds.length}
						剩下的会按间隔重复的节奏在之后几天自动排进队列。
					{/if}
				</p>
				<button class="btn-ghost" onclick={restartRound}>再练一轮全部题目</button>
			</div>
		{:else if current}
			<!--
				进度条替代了原来的「第 N / M 题」纯文字。
				文字仍然保留（读屏和精确定位都需要），但视觉主体是那条会填充的轨道——
				它回答的是「我走到哪了」，这是 AGENTS.md 允许的「进度可见」。
			-->
			<div class="quiz-progress">
				<div
					class="qp-track"
					role="progressbar"
					aria-valuemin="0"
					aria-valuemax={deck.length}
					aria-valuenow={index}
					aria-label="本轮进度"
				>
					<div class="qp-fill" style="--pct: {(index / deck.length) * 100}%"></div>
				</div>
				<div class="qp-meta">
					<span class="counter">第 {index + 1} / {deck.length} 题</span>
					{#if progress.streak > 1}
						<!--
							会话内连击。key 让数字每次变化都重新入场，动效因此能被感知到；
							关掉页面即清零（不落 localStorage），所以它不是跨天打卡。
						-->
						{#key progress.streak}
							<span class="qp-streak">🔥 连对 {progress.streak}</span>
						{/key}
					{/if}
				</div>
			</div>
			<!-- 按题型分派：代码题的判定是异步的，走完全不同的组件 -->
			{#key current.id}
				{#if current.kind === 'code'}
					<CodeQuestionCard question={current} onResolved={handleResolved} onNext={next} />
				{:else}
					<QuizCard question={current} onResolved={handleResolved} onNext={next} />
				{/if}
			{/key}
		{:else}
			<div class="done">
				<p class="done-title">今天没有到期的题</p>
				<p class="done-body">
					全部 {allIds.length} 道题都已安排在未来复习。
					{#if mastery.mastered === allIds.length}
						你已经全部掌握到最高等级。
					{/if}
				</p>
				<button class="btn-ghost" onclick={restartRound}>不等了，现在就练</button>
			</div>
		{/if}
	</section>

	<footer class="page-foot">
		<a href={resolve('/')}>← 返回首页</a>
		{#if ready && mastery.mastered === allIds.length}
			<span class="badge">本关已通</span>
		{/if}
	</footer>
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: 3rem 1.25rem 5rem;
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
		color: var(--color-text-soft);
	}

	.panel {
		display: grid;
		gap: 1rem;
	}

	.background {
		display: grid;
		gap: 0.625rem;
		padding: 1.25rem 1.5rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
	}

	.bg-title {
		font-size: 0.8125rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-faint);
		font-weight: 500;
	}

	.bg-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.375rem;
	}

	.bg-link {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		border: 1px solid transparent;
		color: inherit;
		text-decoration: none;
		font-size: 0.9375rem;
		transition: border-color 140ms ease;
	}

	.bg-link:hover {
		border-color: var(--color-accent);
	}

	.bg-meta {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--color-text-faint);
		white-space: nowrap;
	}

	h2 {
		margin: 0;
		font-size: 1.25rem;
	}

	.section-note {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: var(--color-text-muted);
	}

	.quiz-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.stat b {
		color: var(--color-text-strong);
		font-family: var(--font-mono);
	}

	.stat-warn b {
		color: var(--color-warn);
	}

	.stat-streak {
		color: var(--color-warn);
	}

	.counter {
		margin: 0;
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: var(--color-text-muted);
	}

	/* ── 本轮进度 ── */
	.quiz-progress {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.qp-track {
		height: 8px;
		border-radius: 999px;
		background: var(--color-track);
		overflow: hidden;
	}

	.qp-fill {
		width: var(--pct);
		height: 100%;
		border-radius: inherit;
		background: var(--color-accent);
		/*
		 * 填充用 ease-out-back：进度条推进时轻微过冲再落位，是「走到这了」的落地感。
		 * 时长走 --dur-enter（400ms）而不是判定时长——它是装饰，且不挡住下一步操作。
		 */
		transition: width var(--dur-enter) var(--ease-out-back);
	}

	.qp-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.qp-streak {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-warn);
		/* {#key} 让它每次连击数变化都重新入场，否则数字静默跳变没人会注意到 */
		animation: streak-pop var(--dur-ui) var(--ease-out-back);
	}

	@keyframes streak-pop {
		from {
			transform: scale(0.82);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.placeholder {
		margin: 0;
		color: var(--color-text-faint);
		font-size: 0.9375rem;
	}

	.done {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		padding: 1.75rem;
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}

	.done-title {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--color-ok);
	}

	.done-body {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.btn-ghost {
		font: inherit;
		font-size: 0.9375rem;
		padding: 0.5rem 1rem;
		background: transparent;
		color: var(--color-accent);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		cursor: pointer;
		transition: border-color 140ms ease;
	}

	.btn-ghost:hover {
		border-color: var(--color-accent);
	}

	.page-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 1.5rem;
		font-size: 0.9375rem;
	}

	.page-foot a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.page-foot a:hover {
		text-decoration: underline;
	}

	.badge {
		font-size: 0.8125rem;
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--color-ok) 18%, var(--color-surface));
		color: var(--color-ok);
		border: 1px solid var(--color-ok);
	}
</style>
