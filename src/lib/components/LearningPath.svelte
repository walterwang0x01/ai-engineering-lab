<script lang="ts">
	/**
	 * 学习路径：模块行 + 分段进度条 + 章节骨架 + 紧凑关卡行。
	 *
	 * 视觉规格来自方案 A 的 mockup（用户从三个方案里选定）。设计要点：
	 *
	 *   - **序号 + 三档字号**建立层级：模块 1.5rem、关卡 1rem、章节 chip 0.75rem。
	 *     改版前所有东西都在 1.1rem 附近，模块和关卡视觉等权。
	 *   - **关卡是紧凑行不是大卡片**：改版前 5 张卡把首页拉到 4.1 屏，
	 *     一屏看不到一张完整的卡。
	 *   - **章节 chip 折叠**：AI Agent 工程有 24 个章节，全铺开是一片灰色噪声。
	 *   - **分段进度条**取代无进度感的纯列表，绿=已掌握 / 黄=在学 / 红=需重练。
	 *
	 * 抽成独立组件是为了能用 fixture manifest 做组件测试——
	 * 路由组件要注入 168 篇的假数据得先劫持 fetch。
	 */
	import { resolve } from '$app/paths';
	import { summarizeMastery } from '$lib/quiz/schedule';
	import { progress } from '$lib/storage/progress.svelte';
	import { moduleQuestionIds } from '$lib/curriculum/progress';
	import type { LevelDefinition } from '$lib/levels/types';
	import type { Curriculum, CurriculumModule, CurriculumSection } from '$lib/curriculum/types';

	interface Props {
		curriculum: Curriculum;
		/** slug → Tier A 题目 id，进度条要用它们查掌握度 */
		noteQuestionIds?: Readonly<Record<string, readonly string[]>>;
		/** 进度已从 localStorage 载入。false 时不渲染进度，避免 hydration 前闪烁 */
		progressReady?: boolean;
	}

	let { curriculum, noteQuestionIds = {}, progressReady = false }: Props = $props();

	/** 章节 chip 默认展示上限。超出的折叠，点一下展开 */
	const CHIP_LIMIT = 6;

	/** 记录哪些模块的章节被展开了。用 id 而不是下标，插入模块时不会串位 */
	let expanded = $state<Record<string, boolean>>({});

	function toggle(moduleId: string) {
		expanded[moduleId] = !expanded[moduleId];
	}

	/** 章节名。manifest 里模块根目录下的笔记 section 为空字符串 */
	function sectionLabel(section: string): string {
		return section || '概览';
	}

	/** 模块的可判定题掌握度。去重逻辑在 curriculum/progress 里，两处共用 */
	function moduleMastery(mod: CurriculumModule) {
		return summarizeMastery(moduleQuestionIds(mod, noteQuestionIds), progress.scheduleView);
	}

	/**
	 * 模块右侧的计数文案。
	 *
	 * 拼成单个字符串而不是模板里拼接：Svelte 会吃掉 `{#if}` 块内的前导空白，
	 * 得到「34 篇· 10 道题」这种少一个空格的结果（线上截图里实际发生过）。
	 */
	function moduleMeta(mod: CurriculumModule, questionTotal: number): string {
		const parts = [`${mod.noteCount} 篇`];
		if (questionTotal > 0) parts.push(`${questionTotal} 道题`);
		if (mod.levelCount > 0) parts.push(`${mod.levelCount} 个关卡`);
		return parts.join(' · ');
	}

	/** 进度条下方的图例。只列非零的档，避免「0 道需重练」这类噪声 */
	function masteryLegend(m: ReturnType<typeof moduleMastery>): string {
		const parts: string[] = [];
		if (m.mastered > 0) parts.push(`${m.mastered} 道已掌握`);
		if (m.learning > 0) parts.push(`${m.learning} 道在学`);
		if (m.struggling > 0) parts.push(`${m.struggling} 道需重练`);
		if (m.untouched > 0) parts.push(`${m.untouched} 道未做`);
		return parts.join(' · ');
	}

	function pct(n: number, total: number): number {
		return total > 0 ? (n / total) * 100 : 0;
	}

	/** 关卡行要用的派生数据 */
	function levelData(level: LevelDefinition) {
		const mastery = summarizeMastery(
			level.questions.map((q) => q.id),
			progress.scheduleView
		);
		return {
			mastery,
			done: mastery.total - mastery.untouched,
			codeCount: level.questions.filter((q) => q.kind === 'code').length
		};
	}

	/**
	 * 关卡行的副标题。
	 *
	 * 由数据拼出来而不是给 LevelDefinition 新增一个字段：
	 * 「读完某章之后用它验证」这句话的信息全部已经存在于 curriculum 里，
	 * 再加一份手写文案就等于多一处会过期的真相。
	 */
	function levelSub(section: CurriculumSection, codeCount: number): string {
		const parts = [`读完「${sectionLabel(section.section)}」之后用它验证`];
		if (codeCount > 0) parts.push(`含 ${codeCount} 道浏览器内 Python 题`);
		return parts.join(' · ');
	}
</script>

{#snippet levelRow(level: LevelDefinition, sub: string)}
	{@const d = levelData(level)}
	<!-- class="card" 必须保留：冒烟测试用 a.card 计数断言「首页卡片数 === 预渲染关卡数」 -->
	<a class="card lv" href={resolve('/[levelId]', { levelId: level.id })}>
		<span class="lv-tag">{level.card.tag}</span>
		<span class="lv-main">
			<span class="lv-title">{level.title}</span>
			<span class="lv-sub">{sub}</span>
		</span>
		{#if progressReady}
			<span
				class="ring"
				style="--p: {pct(d.mastery.mastered, d.mastery.total)}%"
				aria-label="已掌握 {d.mastery.mastered} / {d.mastery.total} 题"
			>
				<span class="ring-n">{d.mastery.mastered}/{d.mastery.total}</span>
			</span>
		{:else}
			<span class="lv-q">{d.mastery.total} 道题</span>
		{/if}
		<span class="lv-go">{progressReady && d.done > 0 ? '继续 →' : '开始 →'}</span>
	</a>
{/snippet}

<div class="path" data-testid="learning-path">
	{#each curriculum.modules as mod, i (mod.id)}
		{@const mastery = moduleMastery(mod)}
		{@const open = expanded[mod.id] ?? false}
		{@const visibleSections = open ? mod.sections : mod.sections.slice(0, CHIP_LIMIT)}
		{@const hidden = mod.sections.length - visibleSections.length}
		<section class="mod" data-testid="path-module">
			<div class="mod-top">
				<span class="mod-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
				<!--
					模块名本身是通往笔记库的入口。方案 A 去掉了每模块一条
					「查看这 N 篇笔记 →」（五条一字不差，是改版前的问题之一），
					但入口不能一起去掉，否则模块变成纯展示。
				-->
				<h2 class="mod-name">
					<a class="mod-link" href={resolve('/notes')}>{mod.label}</a>
				</h2>
				<span class="mod-meta" data-testid="module-meta">{moduleMeta(mod, mastery.total)}</span>
			</div>

			{#if progressReady && mastery.total > 0}
				<div class="bar" data-testid="module-bar" aria-hidden="true">
					<i class="seg-done" style="width: {pct(mastery.mastered, mastery.total)}%"></i>
					<i class="seg-learning" style="width: {pct(mastery.learning, mastery.total)}%"></i>
					<i class="seg-bad" style="width: {pct(mastery.struggling, mastery.total)}%"></i>
				</div>
				<p class="bar-legend" data-testid="module-legend">{masteryLegend(mastery)}</p>
			{/if}

			<!--
				只有一个「模块根目录」章节时不渲染 chips：那会显示成
				「入门准备 4 篇 / 概览 4」，把同一个数字说两遍，没有信息量。
			-->
			{#if !(mod.sections.length === 1 && mod.sections[0].dir === '')}
				<ul class="chips" data-testid="section-chips">
					{#each visibleSections as sec (sec.dir)}
						<li class="chip">
							<span class="chip-label">{sectionLabel(sec.section)}</span>
							<span class="chip-n">{sec.notes.length}</span>
						</li>
					{/each}
					{#if hidden > 0 || open}
						<li>
							<button class="chip chip-more" type="button" onclick={() => toggle(mod.id)}>
								{open ? '收起章节 ▴' : `还有 ${hidden} 个章节 ▾`}
							</button>
						</li>
					{/if}
				</ul>
			{/if}

			{#each mod.sections as sec (sec.dir)}
				{#each sec.levels as level (level.id)}
					{@render levelRow(level, levelSub(sec, levelData(level).codeCount))}
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
		<section class="mod" data-testid="orphan-levels">
			<div class="mod-top">
				<span class="mod-num" aria-hidden="true">—</span>
				<h2 class="mod-name">关卡</h2>
				<span class="mod-meta">{curriculum.orphanLevels.length} 个</span>
			</div>
			{#if curriculum.modules.length > 0}
				<p class="orphan-note">这些关卡还没登记背景笔记。</p>
			{/if}
			{#each curriculum.orphanLevels as level (level.id)}
				{@render levelRow(level, `${levelData(level).mastery.total} 道可判定题`)}
			{/each}
		</section>
	{/if}
</div>

<style>
	.path {
		display: grid;
	}

	.mod {
		border-top: 1px solid var(--color-border-subtle);
		padding: 1.25rem 0;
	}

	.mod-top {
		display: grid;
		grid-template-columns: 2.25rem 1fr auto;
		gap: 1rem;
		align-items: baseline;
	}

	.mod-num {
		font-family: var(--font-mono);
		font-size: 1.375rem;
		font-weight: 600;
		color: oklch(0.42 0.02 260);
	}

	.mod-name {
		margin: 0;
		font-size: 1.5rem;
		line-height: 1.2;
	}

	.mod-link {
		color: inherit;
		text-decoration: none;
	}

	.mod-link:hover {
		color: var(--color-accent);
	}

	.mod-meta {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: oklch(0.64 0.01 260);
		white-space: nowrap;
	}

	/* 序号列宽 2.25rem + 间距 1rem，下面所有内容与模块名左对齐 */
	.bar,
	.bar-legend,
	.chips,
	.lv,
	.orphan-note {
		margin-left: 3.25rem;
	}

	.bar {
		margin-top: 0.75rem;
		height: 5px;
		background: var(--color-surface-sunken);
		border-radius: 999px;
		overflow: hidden;
		display: flex;
	}

	.bar i {
		display: block;
		height: 100%;
		transition: width 200ms ease;
	}

	.seg-done {
		background: var(--color-ok);
	}

	.seg-learning {
		background: var(--color-warn);
	}

	.seg-bad {
		background: var(--color-bad);
	}

	.bar-legend {
		margin-top: 0.4375rem;
		margin-bottom: 0;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: oklch(0.6 0.01 260);
	}

	.chips {
		margin-top: 0.875rem;
		margin-bottom: 0;
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
		font-size: 0.75rem;
		padding: 0.1875rem 0.5rem;
		border-radius: 5px;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		color: oklch(0.74 0.01 260);
	}

	.chip-n {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		color: oklch(0.56 0.01 260);
	}

	.chip-more {
		font: inherit;
		font-size: 0.75rem;
		color: var(--color-accent);
		border-color: var(--color-accent-dim);
		cursor: pointer;
	}

	.chip-more:hover {
		border-color: var(--color-accent);
	}

	/* 关卡行：紧凑单行，靠左侧一道 accent 竖线表明身份 */
	.lv {
		margin-top: 0.875rem;
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 0.875rem;
		align-items: center;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-left: 2px solid var(--color-accent);
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	a.lv:hover {
		border-color: var(--color-accent);
		transform: translateY(-1px);
	}

	.lv-tag {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		padding: 0.125rem 0.4375rem;
		border-radius: 4px;
		background: var(--color-surface-sunken);
		color: var(--color-accent);
		white-space: nowrap;
	}

	.lv-title {
		display: block;
		font-size: 1rem;
		font-weight: 600;
	}

	.lv-sub {
		display: block;
		font-size: 0.75rem;
		color: oklch(0.64 0.01 260);
		margin-top: 0.125rem;
	}

	.lv-q {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: oklch(0.66 0.01 260);
		white-space: nowrap;
	}

	.lv-go {
		font-size: 0.8125rem;
		color: var(--color-accent);
		white-space: nowrap;
	}

	/* 进度环：conic-gradient 画外圈，内圈盖回底色留出数字 */
	.ring {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: conic-gradient(var(--color-ok) var(--p), var(--color-surface-sunken) 0);
		display: grid;
		place-items: center;
		flex-shrink: 0;
	}

	.ring-n {
		width: 19px;
		height: 19px;
		border-radius: 50%;
		background: var(--color-surface-raised);
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		display: grid;
		place-items: center;
		color: oklch(0.7 0.01 260);
	}

	.orphan-note {
		margin: 0.75rem 0 0 3.25rem;
		font-size: 0.875rem;
		color: oklch(0.66 0.01 260);
	}

	@media (max-width: 34rem) {
		.mod-top {
			grid-template-columns: 2rem 1fr;
		}

		.mod-meta {
			grid-column: 2;
		}

		.bar,
		.bar-legend,
		.chips,
		.lv,
		.orphan-note {
			margin-left: 0;
		}

		.lv {
			grid-template-columns: 1fr auto;
			row-gap: 0.5rem;
		}

		.lv-main {
			grid-column: 1 / -1;
		}

		/* grid 子项默认 stretch，标签会被拉成整行宽的色块 */
		.lv-tag {
			justify-self: start;
		}
	}
</style>
