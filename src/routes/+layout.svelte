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

	let { children } = $props();
</script>

<nav class="site-nav" aria-label="站点导航">
	<a class="brand" href={resolve('/')}>AI Engineering Lab</a>
	<div class="nav-links">
		<a href={resolve('/')}>关卡</a>
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

	.nav-links a {
		font-size: 0.875rem;
		color: oklch(0.74 0.01 260);
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
