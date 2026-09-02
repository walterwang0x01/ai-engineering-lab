<script lang="ts">
	/**
	 * 全站外壳。
	 *
	 * 这里原来只有 `{@render children()}`，没有任何导航——
	 * 后果是 /notes 和 168 篇笔记在线上是孤儿页面：部署好了、返回 200，
	 * 但站内没有一个链接指向它，只能手输 URL 才能进去。
	 * 导航放在 layout 而不是各页面自己写，是为了这个缺陷不可能只修一半。
	 */
	import './layout.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { isNavCurrent } from '$lib/nav/current';

	let { children } = $props();

	/**
	 * 当前路由是否落在某个导航项下。笔记详情页（/notes/[...slug]）也算「笔记库」，
	 * 这样在阅读笔记时顶栏仍能告诉用户「你现在在笔记库这条线里」。
	 *
	 * 判定用 page.route.id 而不是 page.url.pathname：本项目部署在子路径，
	 * pathname 带 /ai-engineering-lab 前缀，而 $app/paths 的 base 是相对路径
	 * （顶层页是 '.'，深层页是 '../../..'），没法用来剥前缀。详见 $lib/nav/current。
	 */
	function isCurrent(prefixes: readonly string[]): boolean {
		return isNavCurrent(page.route.id, prefixes);
	}
</script>

<nav class="site-nav" aria-label="站点导航">
	<a class="brand" href={resolve('/')}>
		<span>AI Engineering Lab</span>
	</a>
	<div class="nav-links">
		<!--
			「关卡」原来指向首页本身，点了页面不变——零上下文复查者的第一反应是
			「链接坏了」。现在指向真正的关卡索引页。
		-->
		<a
			href={resolve('/')}
			data-testid="nav-path"
			aria-current={isCurrent(['/']) ? 'page' : undefined}
		>
			学习路径
		</a>
		<a
			href={resolve('/levels')}
			data-testid="nav-levels"
			aria-current={isCurrent(['/levels', '/[levelId]']) ? 'page' : undefined}
		>
			关卡
		</a>
		<a
			href={resolve('/notes')}
			data-testid="nav-notes"
			aria-current={isCurrent(['/notes']) ? 'page' : undefined}
		>
			笔记库
		</a>
	</div>
</nav>

{@render children()}

<style>
	.site-nav {
		max-width: 60rem;
		margin: 0 auto;
		padding: 0.25rem 1.25rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.brand {
		/* 与 .nav-links a 同样的 44px 触摸目标（WCAG 2.5.5） */
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		/* 略加重：mono uppercase 在 400 太飘，跟现在的紫罗兰新层次不搭。
		   600 在小字号下仍克制，不会像 700 那样与正文抢权重 */
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-accent);
		text-decoration: none;
		white-space: nowrap;
	}

	.nav-links {
		display: flex;
		gap: 1rem;
	}

	/*
	 * 窄屏把字标缩小，而不是隐藏它。
	 *
	 * 375–420px 下三个导航项原本全部折行，而 CJK 没有断词提示，浏览器在任意字间
	 * 断开——「学习路径」竖成「学习路/径」，可点区域被压到 26–35px 宽。
	 * 375px 是 iPhone SE / 13 mini 一档的常见宽度，主导航又是全站唯一的换页方式。
	 *
	 * 这里原来的做法是「视觉隐藏字标、只留吉祥物」。吉祥物删掉之后那条规则会让
	 * 品牌链接在窄屏上变成完全空白的可点区域——一个看不见却能点的 44px 方块。
	 * 所以改成缩排：字标从 0.8125rem/0.06em 降到 0.6875rem/0.03em ≈ 120px，
	 * 375px 里 120 + 三个链接 150 + 间距 24 + 内边距 40 = 334px，单行放得下。
	 */
	@media (max-width: 480px) {
		.brand {
			font-size: 0.6875rem;
			letter-spacing: 0.03em;
		}

		.nav-links {
			gap: 0.75rem;
		}
	}

	/* 导航项永不逐字折断：宁可整体挤，也不要竖排单字 */
	.nav-links a {
		position: relative;
		/* 导航项永不逐字折断：宁可整体挤，也不要竖排单字 */
		white-space: nowrap;
		font-size: 0.875rem;
		color: var(--color-text-soft);
		text-decoration: none;
		/* 触摸目标至少 44px 高（WCAG 2.5.5）。用 padding 撑开而不是改字号 */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.375rem;
		transition: color var(--dur-ui) var(--ease-out);
	}

	/*
	 * hover / 当前页指示：一条 2px accent 短杆贴在链接底缘。
	 * 不做成"文字下划线"——那需要量文字，pad 撑开后视觉上反而发飘；
	 * 做成全宽的 accent rule，像 tab indicator，读作"这个导航项被标记了"，
	 * 跟卡片 hover（border-color + transform）的反馈语言同源。
	 */
	.nav-links a::after {
		content: '';
		position: absolute;
		left: 0;
		/* 8px 离链接底缘 = 离 nav 下边线 12px，留出明显空气，
		   不撞到底部那条 1px border-subtle */
		bottom: 0.5rem;
		width: 100%;
		height: 2px;
		background: var(--color-accent);
		border-radius: 1px;
		transform: scaleX(0);
		transform-origin: left center;
		transition: transform var(--dur-ui) var(--ease-out);
	}

	.nav-links a:hover {
		color: var(--color-accent);
	}

	.nav-links a:hover::after {
		transform: scaleX(1);
	}

	/*
	 * 当前页：accent 短杆常驻，文字略加深（text-strong vs 默认 text-soft）。
	 * 复查里"我现在在哪个板块"是常被点出来的真缺口，没有这个指示就只能靠 URL 猜。
	 */
	.nav-links a[aria-current='page'] {
		color: var(--color-text-strong);
	}

	.nav-links a[aria-current='page']::after {
		transform: scaleX(1);
	}
</style>
