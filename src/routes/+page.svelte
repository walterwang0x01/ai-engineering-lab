<script lang="ts">
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import LearningPath from '$lib/components/LearningPath.svelte';
	import MasteryLegend from '$lib/components/MasteryLegend.svelte';
	import { LEVELS } from '$lib/levels/registry';
	import { EMPTY_MANIFEST, buildCurriculum } from '$lib/curriculum/build';
	import { summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';
	import type { NotesGradable, NotesManifest } from '$lib/notes/types';

	let progressReady = $state(false);
	let manifest = $state<NotesManifest>(EMPTY_MANIFEST);
	let notesFailed = $state(false);
	/** slug → Tier A 题目 id。首页的题数合计与进度条都要用 */
	let noteQuestionIds = $state<Record<string, string[]>>({});

	/**
	 * manifest 与 gradable 都在客户端 fetch，不在 load 里读文件系统——
	 * 与 /notes 的做法一致，避免把 168 篇的元数据打进预渲染产物。
	 *
	 * 失败或未同步时保持 EMPTY_MANIFEST，curriculum 会把全部关卡放进
	 * orphanLevels，首页仍然完整可用。
	 */
	onMount(async () => {
		progress.load();
		progressReady = true;
		try {
			const [manifestRes, gradableRes] = await Promise.all([
				fetch(`${base}/notes/manifest.json`),
				fetch(`${base}/notes/gradable.json`)
			]);
			if (!manifestRes.ok) throw new Error(String(manifestRes.status));
			manifest = await manifestRes.json();
			if (gradableRes.ok) {
				const data: NotesGradable = await gradableRes.json();
				noteQuestionIds = Object.fromEntries(
					Object.entries(data.items ?? {}).map(([slug, qs]) => [slug, qs.map((q) => q.id)])
				);
			}
		} catch {
			notesFailed = true;
		}
	});

	const curriculum = $derived(buildCurriculum(manifest, LEVELS));

	/** 关卡题 + 笔记题的全站合计。关卡题按关卡去重，笔记题每篇独有 */
	const allQuestionIds = $derived([
		...LEVELS.flatMap((l) => l.questions.map((q) => q.id)),
		...Object.values(noteQuestionIds).flat()
	]);
	const totalQuestions = $derived(allQuestionIds.length);
	const totalCode = $derived(
		LEVELS.reduce((n, l) => n + l.questions.filter((q) => q.kind === 'code').length, 0)
	);
	const overall = $derived(summarizeMastery(allQuestionIds, progress.scheduleView));

	/**
	 * 关卡里有几个是「达标型沙盒」（多约束调参）。
	 *
	 * 不能笼统说「5 个沙盒」——backprop 和 attention 的交互是观察型的，
	 * 没有约束也没有达标判定，把它们算成沙盒是不准确的数字。
	 * 判据取自 registry 的交互标题：达标型的标题统一是「先动手：…」并含「可行/达标」语义，
	 * 所以这里改用一个不会说错的表述：有交互演示的关卡数。
	 */
	const interactiveLevels = $derived(LEVELS.filter((l) => l.interactive).length);
</script>

<Seo
	title="AI Engineering Lab · 交互式 AI 工程练习场"
	description="不是又一个教程站。每个概念都配可判定的计算题和参数沙盒——答错会告诉你错在哪，调参数能看到约束怎么被打破。代码题在浏览器里真跑 Python。纯前端，免费开源。"
	ogImage="home.png"
/>

<main>
	<header class="hero">
		<h1>把 AI 工程知识<br />变成能动手验证的东西</h1>
		<p class="lede">
			读懂和会做是两件事。这里的每个概念都配了<b>能判定对错的题</b>和<b>能调参数的沙盒</b>——
			答错会告诉你错在哪，调参数能看到约束怎么被打破。
		</p>

		<dl class="totals" data-testid="totals">
			<div class="stat">
				<dt class="stat-n accent" data-testid="stat-notes">{curriculum.totalNotes}</dt>
				<dd class="stat-l">篇笔记</dd>
			</div>
			<div class="stat">
				<dt class="stat-n accent" data-testid="stat-questions">{totalQuestions}</dt>
				<!-- 「可判定题」是这个站的自造词。解释原来在页尾，离首次出现差 1600px -->
				<dd class="stat-l">道可判定题<span class="stat-gloss">程序判对错，不是自评</span></dd>
			</div>
			<div class="stat">
				<dt class="stat-n" data-testid="stat-interactive">{interactiveLevels}</dt>
				<dd class="stat-l">个交互演示</dd>
			</div>
			<div class="stat">
				<dt class="stat-n ok" data-testid="stat-mastered">
					{progressReady ? overall.mastered : 0}
				</dt>
				<dd class="stat-l">已掌握</dd>
			</div>
		</dl>
		<p class="sub">
			其中 {totalCode} 道要在浏览器里真跑 Python。全部在你的浏览器里执行，没有后端，不收集数据，学习进度只存在本地。
		</p>
		<!--
			首屏原来没有任何主 CTA：唯一显眼的彩色元素是数字本身（不可点）。
			零上下文复查者「盯着看了几秒不知道下一步动作是什么」。
			两个按钮对应两种真实意图：想动手的直接进关卡，想按顺序读的从笔记读起。
		-->
		<div class="cta-row">
			<a class="btn-primary" href={resolve('/levels')} data-testid="cta-levels">
				动手做题 · {totalQuestions} 道可判定题
			</a>
			<a class="btn-secondary" href={resolve('/notes')} data-testid="cta-notes">
				从第一篇笔记读起 →
			</a>
		</div>
	</header>

	<section class="path-section">
		<div class="section-head">
			<h2 class="section-title">学习路径</h2>
			<a class="all-notes" href={resolve('/notes')}>全部笔记 →</a>
		</div>

		{#if notesFailed}
			<p class="notice" data-testid="notes-unavailable">笔记目录暂时无法加载，下面只列出关卡。</p>
		{/if}

		<LearningPath {curriculum} {noteQuestionIds} {progressReady} />

		{#if progressReady && overall.mastered + overall.learning + overall.struggling > 0}
			<div class="legend-slot"><MasteryLegend /></div>
		{/if}
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
				AI 工程笔记仓库
			</a>
			· 作者的
			<a href="https://walterwang0x01.github.io/portfolio/" rel="noreferrer">博客与简报</a>
		</p>
	</footer>
</main>

<style>
	main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
		display: grid;
		gap: 3rem;
	}

	.hero {
		display: grid;
		gap: 1rem;
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 5.5vw, 2.5rem);
		line-height: 1.15;
		letter-spacing: -0.02em;
	}

	.lede {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.7;
		color: oklch(0.8 0.008 260);
		max-width: 40rem;
	}

	.lede b {
		color: oklch(0.96 0.005 260);
	}

	/* 数字带：一眼看出这站有多少东西、自己走到哪 */
	.totals {
		margin: 0.75rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 2.5rem;
		padding: 1.125rem 1.25rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 12px;
	}

	.stat-n {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.1;
	}

	.stat-n.accent {
		color: var(--color-accent);
	}

	.stat-n.ok {
		color: var(--color-ok);
	}

	.stat-gloss {
		display: block;
		font-size: 0.6875rem;
		color: oklch(0.56 0.01 260);
		margin-top: 0.0625rem;
	}

	.legend-slot {
		margin-top: 1.25rem;
	}

	.stat-l {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: oklch(0.64 0.01 260);
	}

	.cta-row {
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 1.125rem;
		border-radius: 10px;
		font-size: 0.9375rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	.btn-primary {
		background: var(--color-accent);
		color: oklch(0.16 0.012 260);
		border: 1px solid var(--color-accent);
	}

	.btn-secondary {
		color: var(--color-accent);
		border: 1px solid var(--color-border-subtle);
	}

	.btn-primary:hover,
	.btn-secondary:hover {
		transform: translateY(-1px);
		border-color: var(--color-accent);
	}

	.sub {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.7;
		color: oklch(0.64 0.01 260);
	}

	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}

	.section-title {
		margin: 0;
		font-size: 0.8125rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.64 0.01 260);
		font-weight: 500;
	}

	.all-notes {
		/* 独立的导航性链接，窄屏要够大点。行内正文链接不适用这条 */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-size: 0.8125rem;
		color: var(--color-accent);
		text-decoration: none;
		white-space: nowrap;
	}

	.all-notes:hover {
		text-decoration: underline;
	}

	.notice {
		margin: 0 0 1.25rem;
		font-size: 0.875rem;
		color: var(--color-warn);
	}

	.why .section-title {
		margin-bottom: 1.25rem;
	}

	/* dt 和 dd 必须包在 .entry 里：dl 直接用 grid + gap 时，
	   dt 与它自己的 dd 之间也会产生 gap，标题和说明看起来是断开的 */
	.why dl {
		margin: 0;
		display: grid;
		gap: 1.5rem;
	}

	.why dt {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 0.4375rem;
	}

	.why dd {
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

	@media (max-width: 34rem) {
		/* 页脚是两条独立链接，不是句中行内链接，所以适用 44px 规则 */
		.foot a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}

	.foot a:hover {
		text-decoration: underline;
	}
</style>
