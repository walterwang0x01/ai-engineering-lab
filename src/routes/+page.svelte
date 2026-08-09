<script lang="ts">
	import { onMount } from 'svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { LEVELS } from '$lib/levels/registry';
	import { summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';
	import { resolve } from '$app/paths';

	let ready = $state(false);

	onMount(() => {
		progress.load();
		ready = true;
	});

	/**
	 * 卡片从注册表生成，而不是手写。
	 *
	 * 阶段 0 的独立审计发现过一个真实缺陷：新增关卡的文件清单漏了首页入口，
	 * 照文档做会产出「直连能访问、首页进不去」的孤儿页面。
	 * 改成从 registry 派生之后，这个问题在结构上不可能再发生。
	 */
	const cards = $derived(
		LEVELS.map((level) => {
			const ids = level.questions.map((q) => q.id);
			const mastery = summarizeMastery(ids, progress.scheduleView);
			return {
				level,
				mastery,
				done: mastery.total - mastery.untouched,
				codeCount: level.questions.filter((q) => q.kind === 'code').length
			};
		})
	);

	const totalQuestions = $derived(LEVELS.reduce((n, l) => n + l.questions.length, 0));
	const totalCode = $derived(
		LEVELS.reduce((n, l) => n + l.questions.filter((q) => q.kind === 'code').length, 0)
	);
</script>

<Seo
	title="AI Engineering Lab · 交互式 AI 工程练习场"
	description="不是又一个教程站。每个概念都配可判定的计算题和参数沙盒——答错会告诉你错在哪，调参数能看到约束怎么被打破。代码题在浏览器里真跑 Python。纯前端，免费开源。"
	ogImage="home.png"
/>

<main>
	<header class="hero">
		<p class="eyebrow">AI Engineering Lab</p>
		<h1>把 AI 工程知识<br />变成能动手验证的东西</h1>
		<p class="lede">
			读懂和会做是两件事。这里的每个概念都配了<b>能判定对错的计算题</b>和<b>能调参数的沙盒</b>——
			答错会告诉你错在哪，调参数能看到约束怎么被打破。
		</p>
		<p class="sub">
			{totalQuestions} 道题，其中 {totalCode} 道要在浏览器里真跑 Python。 全部在你的浏览器里执行，没有后端，不收集数据，学习进度只存在本地。
		</p>
	</header>

	<section class="levels">
		<h2 class="section-title">关卡</h2>

		{#each cards as { level, mastery, done, codeCount } (level.id)}
			<a class="card" href={resolve('/[levelId]', { levelId: level.id })}>
				<div class="card-top">
					<span class="tag">{level.card.tag}</span>
					{#if ready && mastery.mastered === mastery.total}
						<span class="badge badge-done">已通关</span>
					{:else if ready && done > 0}
						<span class="badge">{done} / {mastery.total}</span>
					{:else if codeCount > 0}
						<span class="badge badge-code">{codeCount} 道代码题</span>
					{/if}
				</div>
				<h3>{level.title}</h3>
				<p>{level.card.summary}</p>
				<ul class="points">
					{#each level.card.points as point (point)}
						<li>{point}</li>
					{/each}
				</ul>
				<span class="cta">开始 →</span>
			</a>
		{/each}

		<div class="card card-soon" aria-disabled="true">
			<div class="card-top">
				<span class="tag">规划中</span>
			</div>
			<h3>更多关卡</h3>
			<p>
				反向传播与死亡 ReLU、Tokenizer 切分、模型合并、RAG 分块策略、Agent 可观测性——
				按同样的「可判定 + 可调参」标准逐个做。
			</p>
		</div>
	</section>

	<section class="why">
		<h2 class="section-title">为什么这样设计</h2>
		<dl>
			<div class="entry">
				<dt>可判定，不是自评</dt>
				<dd>
					「谈谈你对 X 的理解」这类题无法判定，只能自己打分——而人会高估自己。
					这里每道题都有确定答案，程序说了算。代码题更直接：跑测试用例，对就是对。
				</dd>
			</div>

			<div class="entry">
				<dt>答错是入口，不是惩罚</dt>
				<dd>
					第一次答错给提示、允许重答；第二次答错才公布完整推导。
					选错的干扰项会得到针对那个误解的专门解释。
				</dd>
			</div>

			<div class="entry">
				<dt>间隔重复，不是每日打卡</dt>
				<dd>
					答对的题按 1、3、7、16、35 天安排复习。
					不做连续登录天数——深度技术内容需要的是一次沉浸两小时， 而不是每天来点一下。
				</dd>
			</div>
		</dl>
	</section>

	<footer class="foot">
		<p>
			内容来自
			<a href="https://github.com/walterwang0x01/tech-learning-and-projects" rel="noreferrer">
				571 篇 AI 工程笔记
			</a>
			· 作者的
			<a href="https://walterwang0x01.github.io/portfolio/" rel="noreferrer">博客与简报</a>
		</p>
	</footer>
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: 4rem 1.25rem 5rem;
		display: grid;
		gap: 3.5rem;
	}

	.hero {
		display: grid;
		gap: 1rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.8125rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-accent);
		font-family: var(--font-mono);
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		line-height: 1.2;
		letter-spacing: -0.02em;
	}

	.lede {
		margin: 0;
		font-size: 1.125rem;
		line-height: 1.75;
		color: oklch(0.82 0.008 260);
		max-width: 40rem;
	}

	.lede b {
		color: oklch(0.95 0.005 260);
	}

	.sub {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.7;
		color: oklch(0.66 0.01 260);
	}

	.section-title {
		margin: 0 0 1.25rem;
		font-size: 0.8125rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.64 0.01 260);
		font-weight: 500;
	}

	.levels {
		display: grid;
		gap: 1rem;
	}

	.levels .section-title {
		margin-bottom: 0;
	}

	.card {
		display: grid;
		gap: 0.75rem;
		padding: 1.75rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	a.card:hover {
		border-color: var(--color-accent);
		transform: translateY(-2px);
	}

	.card-soon {
		opacity: 0.55;
	}

	.card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.tag {
		font-size: 0.75rem;
		letter-spacing: 0.04em;
		padding: 0.1875rem 0.5rem;
		border-radius: 5px;
		background: var(--color-surface-sunken);
		color: var(--color-accent);
		font-family: var(--font-mono);
	}

	.badge {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		padding: 0.1875rem 0.5rem;
		border-radius: 999px;
		background: var(--color-surface-sunken);
		color: oklch(0.7 0.01 260);
	}

	.badge-done {
		color: var(--color-ok);
		border: 1px solid var(--color-ok);
	}

	.badge-code {
		color: var(--color-accent);
		font-family: var(--font-sans);
	}

	.card h3 {
		margin: 0;
		font-size: 1.25rem;
	}

	.card p {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: oklch(0.76 0.008 260);
	}

	.points {
		margin: 0.25rem 0 0;
		padding-left: 1.125rem;
		display: grid;
		gap: 0.3125rem;
		font-size: 0.875rem;
		color: oklch(0.7 0.01 260);
		line-height: 1.6;
	}

	.cta {
		margin-top: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent);
	}

	/* dt 和 dd 必须包在 .entry 里：dl 直接用 grid + gap 时，
	   dt 与它自己的 dd 之间也会产生 gap，标题和说明看起来是断开的 */
	dl {
		margin: 0;
		display: grid;
		gap: 1.5rem;
	}

	dt {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.4375rem;
	}

	dd {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		color: oklch(0.74 0.01 260);
	}

	.foot {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 1.5rem;
	}

	.foot p {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.7;
		color: oklch(0.64 0.01 260);
	}

	.foot a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.foot a:hover {
		text-decoration: underline;
	}
</style>
