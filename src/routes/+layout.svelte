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
	import Mascot from '$lib/components/Mascot.svelte';

	let { children } = $props();
</script>

<nav class="site-nav" aria-label="站点导航">
	<a class="brand" href={resolve('/')}>
		<!-- 装饰性：紧挨着站名文字，不传 label 以免读屏重复播报 -->
		<Mascot size={26} />
		<span>AI Engineering Lab</span>
	</a>
	<div class="nav-links">
		<!--
			「关卡」原来指向首页本身，点了页面不变——零上下文复查者的第一反应是
			「链接坏了」。现在指向真正的关卡索引页。
		-->
		<a href={resolve('/')} data-testid="nav-path">学习路径</a>
		<a href={resolve('/levels')} data-testid="nav-levels">关卡</a>
		<a href={resolve('/notes')} data-testid="nav-notes">笔记库</a>
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
	 * 窄屏收起字标，只留吉祥物。
	 *
	 * 375–420px 下三个导航项原本全部折行，而 CJK 没有断词提示，浏览器在任意字间
	 * 断开——「学习路径」竖成「学习路/径」，可点区域被压到 26–35px 宽。
	 * 375px 是 iPhone SE / 13 mini 一档的常见宽度，主导航又是全站唯一的换页方式。
	 *
	 * 算一下就知道字标是主因：375px 里字标 155px + 三个链接 162px + 间距 32px
	 * + 内边距 40px = 389px，已经超了，跟吉祥物那 36px 无关。
	 *
	 * 所以收起的是字标而不是吉祥物——紧凑的品牌标记本来就是徽标存在的理由，
	 * 而 28px 的吉祥物让「AI Engineering Lab」这个身份在窄屏上不至于完全消失。
	 * 收起后剩 262px，三个链接都能单行放下。
	 */
	@media (max-width: 480px) {
		.brand span {
			/* 视觉隐藏但读屏仍能读到站名 */
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}

	/* 导航项永不逐字折断：宁可整体挤，也不要竖排单字 */
	.nav-links a {
		white-space: nowrap;
	}

	.nav-links a {
		font-size: 0.875rem;
		color: var(--color-text-soft);
		text-decoration: none;
		/* 触摸目标至少 44px 高（WCAG 2.5.5）。用 padding 撑开而不是改字号 */
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.375rem;
	}

	.nav-links a:hover {
		color: var(--color-accent);
	}
</style>
