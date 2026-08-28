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
				<!--
					绿色只在真的掌握了题之后才出现。新用户这里恒为 0，用成功绿渲染一个 0
					会让「绿=正向成绩」这个规则失效——四个数字里三套颜色且无可推断规则，
					读者就建立不起「蓝=内容量、绿=我的成绩」的映射。
				-->
				<dt
					class="stat-n"
					class:ok={progressReady && overall.mastered > 0}
					data-testid="stat-mastered"
				>
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

	<section class="start-here" data-testid="start-here">
		<h2 class="section-title">从哪开始</h2>
		<ul class="routes">
			<li>
				<span class="route-who">完全入门</span>
				<span class="route-arrow">→</span>
				<a href={resolve('/notes')}>从第一篇笔记读起</a>
				<span class="route-why">按模块顺序，每篇配有可判定题</span>
			</li>
			<li>
				<span class="route-who">有 ML 基础，想深入推理优化</span>
				<span class="route-arrow">→</span>
				<a href={resolve('/kv-cache')}>直接进 KV Cache 关卡</a>
				<span class="route-why">显存公式 + 双约束沙盒，算清楚再往下走</span>
			</li>
			<li>
				<span class="route-who">学过全部关卡，想综合检验</span>
				<span class="route-arrow">→</span>
				<a href={resolve('/deploy-decision')}>综合挑战：部署决策</a>
				<span class="route-why">一个真实场景串起 5 个关卡的知识</span>
			</li>
		</ul>
	</section>

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
		padding: var(--space-7) var(--space-5) var(--space-8);
		display: grid;
		/*
		 * 区块间距不再全站一律 3rem。等距是「每个区块权重相同」的视觉表达，
		 * 而首页是有主次的：hero 之后要断开，功能区之间靠得近。
		 * 具体节奏由各区块自己的 margin 微调，见下面。
		 */
		gap: var(--space-7);
	}

	.hero {
		display: grid;
		gap: var(--space-4);
	}

	h1 {
		margin: 0;
		font-size: var(--fs-display);
		line-height: 1.08;
		letter-spacing: -0.03em;
		/*
		 * **必须显式给 text-strong。** 原来这里没有 color 声明，于是 h1 继承
		 * html 的 --color-text（正文灰）—— 整页最大的字用的不是最重的颜色。
		 * 这是「页面缺少一处确定的黑、视线找不到落点」的直接原因：
		 * 五档灰里最强的那档在首屏根本没出场。
		 */
		color: var(--color-text-strong);
		max-width: 22em;
	}

	.lede {
		margin: 0;
		font-size: var(--fs-md);
		line-height: 1.7;
		color: var(--color-text);
		max-width: 38rem;
	}

	.lede b {
		color: var(--color-text-strong);
	}

	/* 数字带：一眼看出这站有多少东西、自己走到哪 */
	.totals {
		margin: var(--space-2) 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-6);
		padding: var(--space-5);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
	}

	.stat-n {
		margin: 0;
		font-family: var(--font-mono);
		/* 数字是这一带的主角，拉到 --fs-lg 才和 display 标题形成可读的次级关系 */
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.02em;
		/* 非强调的两个数字原来也继承正文灰，和它们下面的标签几乎同色 */
		color: var(--color-text-strong);
	}

	.stat-n.accent {
		color: var(--color-accent);
	}

	.stat-n.ok {
		color: var(--color-ok);
	}

	.stat-gloss {
		display: block;
		font-size: var(--fs-2xs);
		color: var(--color-text-faint);
		margin-top: var(--space-1);
	}

	.legend-slot {
		margin-top: var(--space-5);
	}

	.stat-l {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}

	.cta-row {
		margin-top: var(--space-2);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.btn-primary,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--space-5);
		border-radius: var(--radius-control);
		font-size: var(--fs-base);
		font-weight: 600;
		text-decoration: none;
		/* 用 token 而不是又一个手写的 160ms —— 装饰性过渡统一走 --dur-ui */
		transition:
			border-color var(--dur-ui) var(--ease-out),
			box-shadow var(--dur-ui) var(--ease-out),
			transform var(--dur-ui) var(--ease-out);
	}

	.btn-primary {
		background: var(--color-accent);
		/*
		 * 主按钮标签用 --color-on-accent，不是 --color-surface。
		 * 这一档存在的唯一目的就是「压在强调色填充上的文字」，且 palette.spec.ts
		 * 专门校验它对 --color-accent 达到 4.5:1。借用 --color-surface 看着像对的
		 * （浅色下它也接近白），但那个值的对比度**没有任何测试在盯**，
		 * 主题一调就可能悄悄跌破可读线。
		 */
		color: var(--color-on-accent);
		border: 1px solid var(--color-accent);
	}

	.btn-secondary {
		color: var(--color-accent);
		/* 无底色的幽灵按钮，边框是它唯一的按钮线索——浅色下 border-subtle
		   只有 1.6:1，它会退化成一段带箭头的蓝字 */
		border: 1px solid var(--color-border-strong);
	}

	.btn-primary:hover,
	.btn-secondary:hover {
		transform: translateY(-1px);
		border-color: var(--color-accent);
	}

	.sub {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.7;
		color: var(--color-text-muted);
	}

	/* ─── 从哪开始 路由表 ─── */
	.start-here {
		padding: var(--space-5);
		background: var(--color-surface-raised);
		/*
		 * 这里原来写的是 `var(--color-border)` —— 那个 token **从未被定义过**
		 * （设计系统只有 -subtle 和 -strong）。引用未定义变量会让整条 border
		 * 声明失效，所以这张卡片一直**没有边框**：白卡浮在白页上，边界看不出来。
		 * 静默失效，构建和 svelte-check 都是绿的，只能靠量 computed style 发现。
		 */
		border: 1px solid var(--color-border-subtle);
		/*
		 * 左侧强调条。这是全页唯一的「先看这里」入口，需要一个不依赖字号的权重来源——
		 * 原来它和下面两个 section 视觉权重完全相同，扫读时无从判断该先看哪个。
		 */
		border-left: 3px solid var(--color-accent);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
	}

	/* 焦点卡片的标题走真标题，不跟 .section-title 的眉标样式 */
	.start-here .section-title {
		font-size: var(--fs-md);
		font-weight: 600;
		letter-spacing: -0.01em;
		text-transform: none;
		color: var(--color-text-strong);
		margin: 0 0 var(--space-4);
	}

	.routes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0;
	}

	.routes li {
		display: grid;
		grid-template-columns: auto auto 1fr;
		grid-template-rows: auto auto;
		column-gap: var(--space-2);
		align-items: baseline;
		/*
		 * 分隔线代替 gap。三条路线是并列可选项，读者要做的是逐行对照「哪一条是我」——
		 * 有界的行比纯留白更容易横向对齐扫读。
		 */
		padding: var(--space-3) 0;
		border-top: 1px solid var(--color-border-subtle);
	}

	.routes li:first-child {
		border-top: 0;
		padding-top: 0;
	}

	.routes li:last-child {
		padding-bottom: 0;
	}

	.route-who {
		font-size: var(--fs-base);
		font-weight: 600;
		/* 「谁」是这一行的索引项，要能被扫到，原来用正文灰和后面的说明同色 */
		color: var(--color-text-strong);
	}

	.route-arrow {
		font-size: var(--fs-base);
		color: var(--color-text-faint);
	}

	.routes a {
		font-size: var(--fs-base);
		font-weight: 600;
		color: var(--color-accent);
		text-decoration: none;
	}

	.routes a:hover {
		text-decoration: underline;
	}

	.route-why {
		grid-column: 1 / -1;
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
		line-height: 1.6;
		margin-top: var(--space-1);
	}

	@media (max-width: 540px) {
		.routes li {
			grid-template-columns: 1fr;
		}
		.route-arrow {
			display: none;
		}
	}

	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	/**
	 * 区块标题是**真标题**，不是眉标。
	 *
	 * 原来这里是 `font-size: 0.8125rem` + `uppercase` + `letter-spacing: 0.08em`
	 * + `text-faint` —— 一套典型的英文小眉标样式，问题是：
	 *
	 * 1. **`uppercase` 对中文完全无效**。「学习路径」没有大小写可转，
	 *    这条声明在这个站上做的唯一一件事是零。
	 * 2. **`letter-spacing: 0.08em` 对中文是负作用**。字母间距拉开在英文里制造
	 *    精致的眉标感，在中文里只是把方块字推散。
	 * 3. 于是这套样式实际生效的只剩「最弱的灰 + 13px」—— 每个区块的入口
	 *    在视觉上直接消失，扫读时看不到页面的骨架。
	 *
	 * 换成 --fs-lg + 600 + text-strong，和 h1(display) / 卡片标题(md) 一起
	 * 形成三级层次：页面标题 → 区块标题 → 卡内标题。
	 */
	.section-title {
		margin: 0;
		font-size: var(--fs-lg);
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
		font-weight: 600;
		line-height: 1.3;
	}

	.all-notes {
		/* 独立的导航性链接，窄屏要够大点。行内正文链接不适用这条 */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-size: var(--fs-sm);
		color: var(--color-accent);
		text-decoration: none;
		white-space: nowrap;
	}

	.all-notes:hover {
		text-decoration: underline;
	}

	.notice {
		margin: 0 0 var(--space-5);
		font-size: var(--fs-sm);
		color: var(--color-warn);
	}

	.why .section-title {
		margin-bottom: var(--space-5);
	}

	/* dt 和 dd 必须包在 .entry 里：dl 直接用 grid + gap 时，
	   dt 与它自己的 dd 之间也会产生 gap，标题和说明看起来是断开的 */
	.why dl {
		margin: 0;
		display: grid;
		gap: var(--space-5);
	}

	.why dt {
		font-size: var(--fs-md);
		font-weight: 600;
		/* 三条设计理由的小标题也要立住，原来继承正文灰、和下面的说明区分不足 */
		color: var(--color-text-strong);
		margin-bottom: var(--space-2);
	}

	.why dd {
		margin: 0;
		font-size: var(--fs-base);
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.foot {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--space-5);
	}

	.foot p {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.7;
		color: var(--color-text-muted);
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
