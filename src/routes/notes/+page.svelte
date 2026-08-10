<script lang="ts">
	/**
	 * 学习路径页：按模块 → 章节 → 篇目展示，带已读进度。
	 *
	 * manifest 通过 fetch 获取而不是静态导入——数据在 static/notes/manifest.json，
	 * 由构建期脚本生成，不是 TS 模块，也不该被打进页面 bundle
	 * （168 篇的元数据体积不小，且这类数据天然适合运行时按需加载）。
	 */
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { resolve } from '$app/paths';
	import Seo from '$lib/components/Seo.svelte';
	import { notesProgress } from '$lib/storage/notes-progress.svelte';
	import { progress } from '$lib/storage/progress.svelte';
	import { levelForNote } from '$lib/curriculum/mapping';
	import { noteProgress } from '$lib/curriculum/progress';
	import type { NotesGradable, NotesManifest } from '$lib/notes/types';

	let manifest = $state<NotesManifest | null>(null);
	/** slug → Tier A 题目 id，供统一进度视图判定 */
	let noteQuestionIds = $state<Record<string, string[]>>({});
	let loadError = $state(false);
	let ready = $state(false);

	onMount(async () => {
		notesProgress.load();
		progress.load();
		try {
			const [manifestRes, gradableRes] = await Promise.all([
				fetch(`${base}/notes/manifest.json`),
				fetch(`${base}/notes/gradable.json`)
			]);
			if (!manifestRes.ok) throw new Error(String(manifestRes.status));
			manifest = await manifestRes.json();
			// Tier A 题目 id 必须传给进度视图：没有配套关卡但有可判定题的篇目，
			// 只看关卡会被判成「未开始」——题答对了却显示没开始
			if (gradableRes.ok) {
				const data: NotesGradable = await gradableRes.json();
				noteQuestionIds = Object.fromEntries(
					Object.entries(data.items ?? {}).map(([slug, qs]) => [slug, qs.map((q) => q.id)])
				);
			}
		} catch {
			loadError = true;
		} finally {
			ready = true;
		}
	});

	const totalRead = $derived(
		manifest
			? manifest.modules.reduce(
					(n, mod) =>
						n +
						mod.sections.reduce(
							(m, sec) => m + sec.notes.filter((note) => notesProgress.isRead(note.slug)).length,
							0
						),
					0
				)
			: 0
	);

	/**
	 * 单篇的统一状态。
	 *
	 * 走 curriculum 的裁决规则而不是直接读 `isRead`：有配套关卡的篇目，
	 * 题做完了就该显示「已掌握」，不能因为没点过「标记为读完」而显示成未开始。
	 * 两套存储仍各自独立，这里只是读时合并。
	 */
	function stateOf(slug: string) {
		return noteProgress(
			{ slug },
			{ read: notesProgress.read, schedule: progress.scheduleView, noteQuestionIds }
		).state;
	}

	/**
	 * 哪些模块处于展开状态。默认只展开第一个。
	 *
	 * 改版前 168 篇全平铺，页面 12.3 屏，首屏只看到 9 篇，
	 * 要找某一篇只能 Cmd+F 或肉眼滚 —— 这是新用户复查里的严重度 3 问题。
	 */
	let open = $state<Record<string, boolean>>({});
	const isOpen = (id: string, i: number) => open[id] ?? i === 0;
	function toggleModule(id: string, i: number) {
		open[id] = !isOpen(id, i);
	}

	/** 该模块有多少篇带 Tier A 可判定题。列表页此前完全没有这个信号 */
	function gradableInModule(mod: NotesManifest['modules'][number]): number {
		return mod.sections
			.flatMap((sec) => sec.notes)
			.filter((n) => (noteQuestionIds[n.slug]?.length ?? 0) > 0).length;
	}

	const BADGE: Record<string, { text: string; cls: string } | null> = {
		mastered: { text: '已掌握', cls: 'badge-mastered' },
		'in-progress': { text: '在学', cls: 'badge-learning' },
		read: { text: '已读', cls: 'badge-read' },
		untouched: null
	};
</script>

<Seo
	title="笔记库 · AI Engineering Lab"
	description="AI 工程笔记合集，按模块与章节组织的学习路径。每篇笔记末尾配自测题，帮你确认读完是不是真的懂了。"
	ogImage="home.png"
/>

<main>
	<header class="page-head">
		<p class="eyebrow">笔记库</p>
		<h1>AI 工程笔记：学习路径</h1>
		<p class="lede">
			按模块和章节组织的笔记合集，覆盖数学基础、经典算法、神经网络、大语言模型到 Agent 工程。
			{#if ready && manifest}
				共 {manifest.count} 篇，已读 {totalRead} 篇。
			{/if}
		</p>
		<p class="sub">阅读与答题进度只存在这台设备的浏览器里，换设备或清缓存会重新开始。</p>
	</header>

	{#if !ready}
		<p class="placeholder" data-testid="notes-loading">载入笔记目录…</p>
	{:else if loadError || !manifest}
		<p class="placeholder" data-testid="notes-error">笔记目录暂时无法加载，请稍后重试。</p>
	{:else if manifest.count === 0}
		<p class="placeholder" data-testid="notes-empty">笔记数据尚未同步。</p>
	{:else}
		<div class="modules" data-testid="notes-modules">
			{#each manifest.modules as mod, i (mod.id)}
				{@const shown = isOpen(mod.id, i)}
				{@const gradableNotes = gradableInModule(mod)}
				<section class="module">
					<!-- 模块标题即折叠开关。aria-expanded 让屏幕阅读器听得出展开状态 -->
					<h2>
						<button
							class="mod-toggle"
							type="button"
							aria-expanded={shown}
							aria-controls={`mod-${mod.id}`}
							onclick={() => toggleModule(mod.id, i)}
						>
							<span class="mod-caret" aria-hidden="true">{shown ? '▾' : '▸'}</span>
							<span class="mod-label">{mod.label}</span>
							<span class="count">{mod.notes} 篇</span>
							{#if gradableNotes > 0}
								<span class="count-gradable">{gradableNotes} 篇有可判定题</span>
							{/if}
						</button>
					</h2>
					<div id={`mod-${mod.id}`} class="mod-body" hidden={!shown}>
						{#each mod.sections as sec (sec.dir)}
							<div class="section">
								{#if sec.section}
									<h3>{sec.section}</h3>
								{/if}
								<ul class="note-list">
									{#each sec.notes as note (note.slug)}
										<li>
											<a
												class="note-link"
												class:is-read={notesProgress.isRead(note.slug)}
												href={resolve('/notes/[...slug]', { slug: note.slug })}
												data-testid="note-link"
											>
												<span class="note-title">{note.title}</span>
												<span class="note-meta">
													{#if ready}
														{@const badge = BADGE[stateOf(note.slug)]}
														{#if badge}
															<span class={badge.cls} data-testid="note-state">{badge.text}</span>
														{/if}
													{/if}
													{#if (noteQuestionIds[note.slug]?.length ?? 0) > 0}
														<span class="badge-gradable" data-testid="note-has-gradable">
															{noteQuestionIds[note.slug].length} 道可判定题
														</span>
													{/if}
													{#if levelForNote(note.slug)}
														<span class="badge-level" data-testid="note-has-level">关卡</span>
													{/if}
													<span>{note.minutes} 分钟</span>
													{#if note.hasQuiz}<span>· 自测题</span>{/if}
												</span>
											</a>
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}

	<footer class="page-foot">
		<a href={resolve('/')}>← 返回首页</a>
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

	.placeholder {
		margin: 0;
		color: oklch(0.62 0.01 260);
		font-size: 0.9375rem;
	}

	.modules {
		display: grid;
		gap: 2rem;
	}

	.module h2 {
		margin: 0 0 0.75rem;
		font-size: 1.25rem;
	}

	/* 模块标题即折叠开关。做成 button 以获得原生键盘与语义支持 */
	.mod-toggle {
		font: inherit;
		width: 100%;
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
		padding: 0.5rem 0;
		background: none;
		border: 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.mod-toggle:hover .mod-label {
		color: var(--color-accent);
	}

	.mod-caret {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: oklch(0.6 0.01 260);
	}

	.mod-label {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.count-gradable {
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--color-ok);
	}

	.mod-body[hidden] {
		display: none;
	}

	.badge-gradable {
		color: var(--color-ok);
		white-space: nowrap;
	}

	.count {
		font-size: 0.8125rem;
		font-family: var(--font-mono);
		color: oklch(0.64 0.01 260);
	}

	.section {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.section h3 {
		margin: 0;
		font-size: 0.9375rem;
		color: oklch(0.72 0.01 260);
		font-weight: 500;
	}

	.note-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.375rem;
	}

	.note-link {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.625rem 0.875rem;
		border-radius: 8px;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		text-decoration: none;
		color: inherit;
		transition: border-color 140ms ease;
	}

	.note-link:hover {
		border-color: var(--color-accent);
	}

	.note-link.is-read {
		opacity: 0.68;
	}

	.note-title {
		font-size: 0.9375rem;
	}

	.sub {
		margin: 0.375rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: oklch(0.64 0.01 260);
	}

	.note-meta {
		flex-shrink: 0;
		display: flex;
		gap: 0.375rem;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: oklch(0.64 0.01 260);
		white-space: nowrap;
	}

	.badge-read {
		color: var(--color-ok);
	}

	.badge-mastered {
		color: var(--color-ok);
		font-weight: 600;
	}

	.badge-learning {
		color: var(--color-warn);
	}

	.badge-level {
		color: var(--color-accent);
	}

	.page-foot {
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
</style>
