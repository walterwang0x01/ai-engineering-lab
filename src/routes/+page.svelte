<script lang="ts">
	import { onMount } from 'svelte';
	import { base, resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import LearningPath from '$lib/components/LearningPath.svelte';
	import { LEVELS } from '$lib/levels/registry';
	import { EMPTY_MANIFEST, buildCurriculum } from '$lib/curriculum/build';
	import { progress } from '$lib/storage/progress.svelte';
	import type { NotesGradable, NotesManifest } from '$lib/notes/types';

	let progressReady = $state(false);
	let manifest = $state<NotesManifest>(EMPTY_MANIFEST);
	let notesFailed = $state(false);
	/** slug → Tier A 题数，用于在模块计数里显示「12 道可判定题」 */
	let gradableCounts = $state<Record<string, number>>({});

	/**
	 * manifest 在客户端 fetch，不在 load 里读文件系统——
	 * 与 /notes 的做法一致，避免把 168 篇的元数据打进预渲染产物。
	 *
	 * 失败或未同步时 manifest 保持 EMPTY_MANIFEST，curriculum 会把
	 * 全部关卡放进 orphanLevels，首页仍然完整可用。
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
				gradableCounts = Object.fromEntries(
					Object.entries(data.items ?? {}).map(([slug, qs]) => [slug, qs.length])
				);
			}
		} catch {
			notesFailed = true;
		}
	});

	const curriculum = $derived(buildCurriculum(manifest, LEVELS));
	const totalQuestions = $derived(LEVELS.reduce((n, l) => n + l.questions.length, 0));
	const totalCode = $derived(
		LEVELS.reduce((n, l) => n + l.questions.filter((q) => q.kind === 'code').length, 0)
	);

	/**
	 * 拼成单个字符串而不是在模板里用 `{#if}` 插入笔记篇数：
	 * Svelte 会吃掉 if 块内的前导换行，得到少一个空格或多一个空格的文案。
	 */
	const subLine = $derived(
		`${totalQuestions} 道题，其中 ${totalCode} 道要在浏览器里真跑 Python` +
			(curriculum.totalNotes > 0 ? `，配 ${curriculum.totalNotes} 篇笔记` : '') +
			'。全部在你的浏览器里执行，没有后端，不收集数据，学习进度只存在本地。'
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
		<p class="sub">{subLine}</p>
	</header>

	<section class="path-section">
		<div class="section-head">
			<h2 class="section-title">学习路径</h2>
			<a class="all-notes" href={resolve('/notes')}>全部笔记 →</a>
		</div>

		{#if notesFailed}
			<p class="notice" data-testid="notes-unavailable">笔记目录暂时无法加载，下面只列出关卡。</p>
		{/if}

		<LearningPath {curriculum} {gradableCounts} {progressReady} />
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
		max-width: 52rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
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

	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
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
