<script lang="ts">
	import { onMount } from 'svelte';
	import QuizCard from '$lib/components/QuizCard.svelte';
	import KvCacheSandbox from '$lib/components/KvCacheSandbox.svelte';
	import { KV_CACHE_QUESTIONS } from '$lib/quiz/kv-cache-questions';
	import { buildDueDeck, summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';
	import { resolve } from '$app/paths';

	const allIds = KV_CACHE_QUESTIONS.map((q) => q.id);

	let ready = $state(false);
	let deck = $state<string[]>([]);
	let index = $state(0);

	// 用 onMount 而非 $effect：deck 只在进入页面时构建一次，
	// 否则每次答题更新 records 都会重建队列、打乱进度
	onMount(() => {
		progress.load();
		deck = buildDueDeck(allIds, progress.scheduleView, Date.now(), allIds.length);
		ready = true;
	});

	const current = $derived(
		deck.length > 0 && index < deck.length
			? KV_CACHE_QUESTIONS.find((q) => q.id === deck[index])
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
</script>

<svelte:head>
	<title>KV Cache 容量规划 · AI Engineering Lab</title>
	<meta
		name="description"
		content="通过可判定的计算题和参数沙盒，掌握 KV Cache 显存计算、GQA/MQA 权衡与推理服务容量规划。"
	/>
</svelte:head>

<main>
	<header class="page-head">
		<p class="eyebrow">推理优化 · 第 1 关</p>
		<h1>KV Cache 容量规划</h1>
		<p class="lede">
			这一关结束后，你应该能在白板上直接算出「这个模型这个并发要几张卡」， 并说清 GQA
			的组数该怎么定。
		</p>
	</header>

	<section class="panel">
		<h2>先动手：找出可行配置</h2>
		<p class="section-note">先玩再学。不用先读理论——直接调参数，看约束怎么被打破，再回来做题。</p>
		<KvCacheSandbox />
	</section>

	<section class="panel">
		<div class="quiz-head">
			<h2>自测：{KV_CACHE_QUESTIONS.length} 道可判定题</h2>
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

		<p class="section-note">
			每道题都有确定答案，答错会给出针对性的解释。 答对的题会按间隔重复安排复习——1 天、3 天、7
			天、16 天、35 天， 这比一次刷完再也不看的留存率高得多。
		</p>

		{#if !ready}
			<p class="placeholder">载入进度…</p>
		{:else if finished}
			<div class="done">
				<p class="done-title">这一轮做完了</p>
				<p class="done-body">
					本轮最佳连击 {progress.bestStreak}。 已掌握 {mastery.mastered} / {allIds.length} 题。
					{#if mastery.mastered < allIds.length}
						剩下的会按间隔重复的节奏在之后几天自动排进队列。
					{/if}
				</p>
				<button class="btn-ghost" onclick={restartRound}>再练一轮全部题目</button>
			</div>
		{:else if current}
			<p class="counter">第 {index + 1} / {deck.length} 题</p>
			{#key current.id}
				<QuizCard question={current} onResolved={handleResolved} onNext={next} />
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
		color: oklch(0.78 0.008 260);
	}

	.panel {
		display: grid;
		gap: 1rem;
	}

	h2 {
		margin: 0;
		font-size: 1.25rem;
	}

	.section-note {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: oklch(0.7 0.01 260);
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
		color: oklch(0.68 0.01 260);
	}

	.stat b {
		color: oklch(0.92 0.005 260);
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
		color: oklch(0.66 0.01 260);
	}

	.placeholder {
		margin: 0;
		color: oklch(0.62 0.01 260);
		font-size: 0.9375rem;
	}

	.done {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
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
		color: oklch(0.78 0.008 260);
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
