<script lang="ts">
	/**
	 * 学习路径：模块 → 章节骨架 → 挂在该模块的关卡。
	 *
	 * 抽成独立组件而不是写在首页里，是为了能用 fixture manifest 做组件测试——
	 * 路由组件要注入 168 篇的假数据很别扭（得先劫持 fetch）。
	 *
	 * 刻意**不在首页展开全部篇目**：43 个章节共 168 篇，全铺开会有 168 个链接，
	 * 把 5 个关卡淹掉，也违反「视觉克制」。首页给的是路径骨架
	 * （模块 + 章节名 + 篇数），点进笔记库看完整篇目列表。
	 */
	import { resolve } from '$app/paths';
	import { summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';
	import type { LevelDefinition } from '$lib/levels/types';
	import type { Curriculum, CurriculumModule } from '$lib/curriculum/types';

	interface Props {
		curriculum: Curriculum;
		/**
		 * slug → 该篇的 Tier A 可判定题数。
		 *
		 * 不传就不显示。入门准备 4 篇有 12 道可判定题，
		 * 而首页原先只显示「4 篇」——新功能在首页完全看不见。
		 */
		gradableCounts?: Readonly<Record<string, number>>;
		/** 进度已从 localStorage 载入。false 时不渲染掌握度徽章，避免 hydration 前闪烁 */
		progressReady?: boolean;
	}

	let { curriculum, gradableCounts = {}, progressReady = false }: Props = $props();

	/** 关卡卡片要用的派生数据。徽章逻辑与旧首页一致，不改判定口径 */
	function cardData(level: LevelDefinition) {
		const ids = level.questions.map((q) => q.id);
		const mastery = summarizeMastery(ids, progress.scheduleView);
		return {
			mastery,
			done: mastery.total - mastery.untouched,
			codeCount: level.questions.filter((q) => q.kind === 'code').length
		};
	}

	/** 章节名。manifest 里模块根目录下的笔记 section 为空字符串 */
	function sectionLabel(section: string): string {
		return section || '概览';
	}

	/**
	 * 模块计数文案。
	 *
	 * 拼成单个字符串而不是在模板里用 `{#if}` 拼接：
	 * Svelte 会吃掉 if 块内的前导换行与缩进，得到「2 篇· 2 个关卡」这种少一个空格的结果，
	 * 而且断言要跟着模板缩进走，非常脆。
	 */
	function moduleMeta(mod: CurriculumModule): string {
		const parts = [`${mod.noteCount} 篇`];
		if (mod.levelCount > 0) parts.push(`${mod.levelCount} 个关卡`);
		const gradable = mod.sections
			.flatMap((s) => s.notes)
			.reduce((n, note) => n + (gradableCounts[note.slug] ?? 0), 0);
		if (gradable > 0) parts.push(`${gradable} 道可判定题`);
		return parts.join(' · ');
	}
</script>

{#snippet levelCard(level: LevelDefinition)}
	{@const d = cardData(level)}
	<!-- class="card" 必须保留：冒烟测试用 a.card 计数断言「首页卡片数 === 预渲染关卡数」 -->
	<a class="card" href={resolve('/[levelId]', { levelId: level.id })}>
		<div class="card-top">
			<span class="tag">{level.card.tag}</span>
			{#if progressReady && d.mastery.mastered === d.mastery.total}
				<span class="badge badge-done">已通关</span>
			{:else if progressReady && d.done > 0}
				<span class="badge">{d.done} / {d.mastery.total}</span>
			{:else if d.codeCount > 0}
				<span class="badge badge-code">{d.codeCount} 道代码题</span>
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
{/snippet}

<div class="path" data-testid="learning-path">
	{#each curriculum.modules as mod (mod.id)}
		<section class="module" data-testid="path-module">
			<header class="module-head">
				<h2>{mod.label}</h2>
				<span class="module-meta" data-testid="module-meta">{moduleMeta(mod)}</span>
			</header>

			<!--
				只有一个「模块根目录」章节时不渲染 chips：那会显示成
				「入门准备 4 篇 / 概览 4」，把同一个数字说两遍，没有信息量。
			-->
			{#if !(mod.sections.length === 1 && mod.sections[0].dir === '')}
				<ul class="chips" data-testid="section-chips">
					{#each mod.sections as sec (sec.dir)}
						<li class="chip">
							<span class="chip-label">{sectionLabel(sec.section)}</span>
							<span class="chip-n">{sec.notes.length}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<a class="module-link" href={resolve('/notes')}>
				查看这 {mod.noteCount} 篇笔记 →
			</a>

			{#each mod.sections as sec (sec.dir)}
				{#each sec.levels as level (level.id)}
					<div class="level-slot">
						<p class="level-anchor">
							读完「{sectionLabel(sec.section)}」之后，用这一关验证
						</p>
						{@render levelCard(level)}
					</div>
				{/each}
			{/each}
		</section>
	{/each}

	<!--
		孤儿关卡必须渲染。笔记未同步时 curriculum.modules 是空的，
		不单独渲染这一段会让 5 个关卡从首页整体消失 ——
		那正是这一层要修的缺陷，只是方向反过来。
	-->
	{#if curriculum.orphanLevels.length > 0}
		<section class="module" data-testid="orphan-levels">
			<header class="module-head">
				<h2>关卡</h2>
				<span class="module-meta">{curriculum.orphanLevels.length} 个</span>
			</header>
			{#if curriculum.modules.length > 0}
				<p class="orphan-note">这些关卡还没登记背景笔记。</p>
			{/if}
			{#each curriculum.orphanLevels as level (level.id)}
				{@render levelCard(level)}
			{/each}
		</section>
	{/if}
</div>

<style>
	.path {
		display: grid;
		gap: 2.75rem;
	}

	.module {
		display: grid;
		gap: 0.875rem;
	}

	.module-head {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.module-head h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	.module-meta {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: oklch(0.64 0.01 260);
	}

	.chips {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3125rem;
		padding: 0.1875rem 0.5rem;
		border-radius: 5px;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		font-size: 0.75rem;
		color: oklch(0.72 0.01 260);
	}

	.chip-n {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: oklch(0.58 0.01 260);
	}

	.module-link {
		justify-self: start;
		font-size: 0.875rem;
		color: var(--color-accent);
		text-decoration: none;
	}

	.module-link:hover {
		text-decoration: underline;
	}

	.level-slot {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.375rem;
	}

	.level-anchor {
		margin: 0;
		font-size: 0.8125rem;
		color: oklch(0.66 0.01 260);
	}

	.orphan-note {
		margin: 0;
		font-size: 0.875rem;
		color: oklch(0.66 0.01 260);
	}

	/* 关卡卡片样式与改版前一致，避免视觉回归 */
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
</style>
