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
	import {
		hasInteraction,
		interactionCountForNote,
		interactionIdsForNote
	} from '$lib/notes/widgets';
	import { interactionProgress } from '$lib/storage/interaction-progress.svelte';
	import type { NotesGradable, NotesManifest } from '$lib/notes/types';

	let manifest = $state<NotesManifest | null>(null);
	/** slug → Tier A 题目 id，供统一进度视图判定 */
	let noteQuestionIds = $state<Record<string, string[]>>({});
	let loadError = $state(false);
	let ready = $state(false);

	onMount(async () => {
		notesProgress.load();
		progress.load();
		interactionProgress.load();
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
			// 必须等 manifest 到位：s-<模块>-<章节> 形式的锚点要用真实模块 id 做前缀匹配
			openFromHash();
		}
	});

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

	function hasExperiencedInteraction(slug: string): boolean {
		return interactionIdsForNote(slug).some((id) => interactionProgress.hasInteracted(id));
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

	/**
	 * 按 URL 的 hash 展开对应模块。
	 *
	 * 首页的章节 chip 和模块名现在链到 `#m-<模块>` / `#s-<模块>-<章节>`。
	 * 模块默认折叠，如果不主动展开，点过来只会看到一片收起的标题——
	 * 那比原来「全部指向 /notes」更糟。
	 */
	function openFromHash() {
		const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
		if (hash === '') return;
		const moduleId = hash.startsWith('m-')
			? hash.slice(2)
			: hash.startsWith('s-')
				? (manifestModuleIdFor(hash.slice(2)) ?? '')
				: '';
		if (moduleId) open[moduleId] = true;

		// 展开是响应式的，要等 DOM 更新后再滚
		requestAnimationFrame(() => {
			document.getElementById(hash)?.scrollIntoView({ block: 'start' });
		});
	}

	/**
	 * 从 `s-<模块>-<章节目录>` 里切出模块 id。
	 *
	 * 不能简单按第一个 `-` 切：模块 id 本身就带数字前缀和连字符
	 * （`01-machine-learning`），章节目录也是（`04-神经网络原理`）。
	 * 所以拿真实模块 id 去前缀匹配，而不是猜分隔位置。
	 */
	function manifestModuleIdFor(rest: string): string | undefined {
		return manifest?.modules.find((m) => rest.startsWith(`${m.id}-`))?.id;
	}

	/** 该模块有多少篇带 Tier A 可判定题。列表页此前完全没有这个信号 */
	function gradableInModule(mod: NotesManifest['modules'][number]): number {
		return mod.sections
			.flatMap((sec) => sec.notes)
			.filter((n) => (noteQuestionIds[n.slug]?.length ?? 0) > 0).length;
	}

	let query = $state('');
	let onlyGradable = $state(false);
	let onlyInteractive = $state(false);

	const filtering = $derived(query.trim() !== '' || onlyGradable || onlyInteractive);

	/** 一篇笔记是否通过当前筛选 */
	function matches(note: { slug: string; title: string }): boolean {
		if (onlyGradable && (noteQuestionIds[note.slug]?.length ?? 0) === 0) return false;
		if (onlyInteractive && !hasInteraction(note.slug)) return false;
		const q = query.trim().toLowerCase();
		return q === '' || note.title.toLowerCase().includes(q);
	}

	const matchCount = $derived(
		manifest
			? manifest.modules.reduce(
					(n, mod) => n + mod.sections.reduce((m, sec) => m + sec.notes.filter(matches).length, 0),
					0
				)
			: 0
	);

	const BADGE: Record<string, { text: string; cls: string } | null> = {
		mastered: { text: '已掌握', cls: 'badge-mastered' },
		'in-progress': { text: '在学', cls: 'badge-learning' },
		read: { text: '已读', cls: 'badge-read' },
		untouched: null
	};

	/**
	 * 全站笔记的四态聚合。
	 *
	 * `stateOf` 早就能算出每一篇是「已掌握 / 在学 / 已读 / 没读过」，
	 * 而页头只有一句「共 168 篇，已读 12 篇」——一个数字盖掉了四档信息，
	 * 「已读」还把真正做完题的篇目也算进去，读者看不出自己到底掌握了多少。
	 * 关卡页刚修掉同一个毛病（那边是把四档压成 `10 / 12 做过`），这里同源。
	 */
	const noteStats = $derived.by(() => {
		const s = { total: 0, mastered: 0, learning: 0, read: 0, untouched: 0 };
		if (!manifest) return s;
		for (const mod of manifest.modules) {
			for (const sec of mod.sections) {
				for (const note of sec.notes) {
					s.total += 1;
					const st = stateOf(note.slug);
					if (st === 'mastered') s.mastered += 1;
					else if (st === 'in-progress') s.learning += 1;
					else if (st === 'read') s.read += 1;
					else s.untouched += 1;
				}
			}
		}
		return s;
	});

	/** 已经动过的篇数 —— 决定要不要渲染那条进度带 */
	const touched = $derived(noteStats.mastered + noteStats.learning + noteStats.read);

	function pct(n: number, total: number): number {
		return total === 0 ? 0 : (n / total) * 100;
	}

	/** 某个模块在当前筛选下命中几篇。用来把整块空模块整个跳过 */
	function matchesInModule(mod: NotesManifest['modules'][number]): number {
		return mod.sections.reduce((n, sec) => n + sec.notes.filter(matches).length, 0);
	}

	function clearFilters() {
		query = '';
		onlyGradable = false;
		onlyInteractive = false;
	}
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
				共 {manifest.count} 篇。
			{/if}
		</p>

		{#if ready && manifest && touched > 0}
			<!--
				四态聚合。原来页头只有「共 168 篇，已读 12 篇」——
				一个数字盖掉了四档，而且「已读」把做完题的篇目也算进去，
				读者看不出自己真正掌握了多少。四档色与关卡页、首页、
				MasteryLegend 完全一致：绿掌握、琥珀在学、蓝已读、灰轨没读过。
			-->
			<div class="track" data-testid="notes-progress" aria-hidden="true">
				<i class="seg ok" style="width: {pct(noteStats.mastered, noteStats.total)}%"></i>
				<i class="seg warn" style="width: {pct(noteStats.learning, noteStats.total)}%"></i>
				<i class="seg info" style="width: {pct(noteStats.read, noteStats.total)}%"></i>
			</div>
			<p class="track-legend">
				已掌握 {noteStats.mastered} · 在学 {noteStats.learning} · 已读 {noteStats.read} · 没读过
				{noteStats.untouched}
			</p>
		{/if}
		<p class="sub">
			「已读」要在笔记末尾自己点一下「标记为读完」——这个站不按滚动位置猜你读没读。
			有可判定题的篇目会显示掌握度，那个是程序判的。
			阅读与答题进度只存在这台设备的浏览器里，换设备或清缓存会重新开始。
		</p>
	</header>

	{#if ready && manifest && manifest.count > 0}
		<!--
			168 篇原来既无搜索也无筛选，「AI Agent 工程」一个模块 105 篇，
			展开就是一面墙。搜索是纯客户端过滤，命中时自动展开所有模块。
		-->
		<div class="filters">
			<label class="search">
				<span class="sr-only">按标题搜索笔记</span>
				<input
					type="search"
					placeholder="搜索标题…"
					bind:value={query}
					data-testid="notes-search"
				/>
			</label>
			<label class="only-gradable">
				<input type="checkbox" bind:checked={onlyGradable} data-testid="only-gradable" />
				只看有可判定题的
			</label>
			<label class="only-gradable">
				<input type="checkbox" bind:checked={onlyInteractive} data-testid="only-interactive" />
				只看可交互的
			</label>
			{#if query.trim() !== '' || onlyGradable || onlyInteractive}
				<span class="filter-count" data-testid="filter-count">{matchCount} 篇匹配</span>
			{/if}
		</div>
	{/if}

	{#if !ready}
		<p class="placeholder" data-testid="notes-loading">载入笔记目录…</p>
	{:else if loadError || !manifest}
		<p class="placeholder" data-testid="notes-error">笔记目录暂时无法加载，请稍后重试。</p>
	{:else if manifest.count === 0}
		<p class="placeholder" data-testid="notes-empty">笔记数据尚未同步。</p>
	{:else}
		<div class="modules" data-testid="notes-modules">
			{#each manifest.modules as mod, i (mod.id)}
				{@const shown = filtering ? true : isOpen(mod.id, i)}
				{@const gradableNotes = gradableInModule(mod)}
				{@const hits = matchesInModule(mod)}
				<!--
					筛选时把一篇都没命中的模块整块跳过。

					原来只过滤了篇目、模块外壳照渲染：搜一个没有的词，
					`filtering` 会强制展开全部模块，于是页面变成 6 个模块标题
					加一串章节小标题、底下全是空的 —— 看起来像站坏了，
					而真正的信息（「没找到」）一个字都没有。
				-->
				{#if !filtering || hits > 0}
					<section class="module" id={`m-${mod.id}`}>
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
								<!-- 首页的模块带 01–05 编号，这里原来没有：同一组东西两套写法 -->
								<span class="mod-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
								<span class="mod-label">{mod.label}</span>
								<span class="count">{mod.notes} 篇</span>
								{#if gradableNotes > 0}
									<span class="count-gradable">{gradableNotes} 篇有可判定题</span>
								{/if}
							</button>
						</h2>
						<div id={`mod-${mod.id}`} class="mod-body" hidden={!shown}>
							{#each mod.sections as sec (sec.dir)}
								<div class="section" id={`s-${mod.id}-${sec.dir}`}>
									{#if sec.section}
										<h3>{sec.section}</h3>
									{/if}
									<ul class="note-list">
										{#each sec.notes.filter(matches) as note (note.slug)}
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
														{#if hasInteraction(note.slug)}
															<span class="badge-interactive" data-testid="note-has-interaction">
																{#if hasExperiencedInteraction(note.slug)}
																	{interactionCountForNote(note.slug)} 个实验 · 已体验
																{:else}
																	{interactionCountForNote(note.slug)} 个可调实验
																{/if}
															</span>
														{/if}
														{#if levelForNote(note.slug)}
															<span class="badge-level" data-testid="note-has-level">关卡</span>
														{/if}
														<span>{note.minutes} 分钟</span>
														<!--
												原来这里写「· 自测题」，挂在几乎全部 168 篇上，
												但它指的是开放式回顾题、不可判定。而真正有可判定题的
												只有绿色那个标记。零上下文复查者被这个假标签骗了一次：
												「两个长得几乎一样的标签，一个有信息量一个没有」。
											-->
														{#if note.hasQuiz}<span>· 开放题</span>{/if}
													</span>
												</a>
											</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			{/each}
		</div>

		{#if filtering && matchCount === 0}
			<p class="no-hit" data-testid="notes-no-hit">
				没有匹配的笔记。
				<button type="button" onclick={clearFilters}>清除筛选</button>
			</p>
		{/if}
	{/if}

	<footer class="page-foot">
		<a href={resolve('/')}>← 返回首页</a>
	</footer>
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-7) var(--space-5) var(--space-8);
		display: grid;
		gap: var(--space-6);
	}

	.page-head {
		display: grid;
		gap: var(--space-3);
	}

	/*
	 * 眉标去掉 uppercase + letter-spacing：对中文做不了任何事
	 * （「笔记库」没有大小写可转），字距只会把方块字推散。
	 * 与首页、关卡页同源修正。
	 */
	.eyebrow {
		margin: 0;
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--color-accent);
	}

	h1 {
		margin: 0;
		font-size: var(--fs-xl);
		line-height: 1.2;
		letter-spacing: -0.02em;
		color: var(--color-text-strong);
	}

	.lede {
		margin: 0;
		font-size: var(--fs-md);
		line-height: 1.75;
		color: var(--color-text);
	}

	.placeholder {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--fs-base);
	}

	/* ── 四态进度带 ── */
	.track {
		display: flex;
		height: 8px;
		/* 轨道用 --color-track 而不是 sunken：新用户四档全为 0，
		   轨道是那一刻唯一可见的部分，sunken 在浅色下只有 1.1:1 等于不存在 */
		background: var(--color-track);
		border-radius: 999px;
		overflow: hidden;
	}

	.seg {
		transition: width var(--dur-ui) var(--ease-out);
	}

	.seg.ok {
		background: var(--color-ok);
	}

	.seg.warn {
		background: var(--color-warn);
	}

	/* 「已读但没做题」用强调色而不是第三种绿：它是中性事实，不是成绩 */
	.seg.info {
		background: var(--color-accent);
	}

	.track-legend {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}

	/* ── 无命中 ── */
	.no-hit {
		margin: 0;
		padding: var(--space-5);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		font-size: var(--fs-sm);
		color: var(--color-text-soft);
	}

	.no-hit button {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: underline;
	}

	.modules {
		display: grid;
		gap: var(--space-6);
	}

	.module h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--fs-lg);
	}

	/* 模块标题即折叠开关。做成 button 以获得原生键盘与语义支持 */
	.mod-toggle {
		font: inherit;
		width: 100%;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		background: none;
		border: 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.mod-toggle:hover .mod-label {
		color: var(--color-accent);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.search input {
		font: inherit;
		font-size: var(--fs-base);
		min-height: 44px;
		padding: 0 var(--space-3);
		min-width: 14rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-control);
		color: inherit;
	}

	.search input:focus-visible {
		border-color: var(--color-accent);
	}

	.only-gradable {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		font-size: var(--fs-sm);
		color: var(--color-text-soft);
		cursor: pointer;
	}

	.filter-count {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		color: var(--color-accent);
	}

	.mod-num {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		color: var(--color-text-faint);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.mod-caret {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		color: var(--color-text-faint);
	}

	.mod-label {
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--color-text-strong);
	}

	.count-gradable {
		font-size: var(--fs-xs);
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

	.badge-interactive {
		color: var(--color-accent);
		font-weight: 600;
		white-space: nowrap;
	}

	.count {
		font-size: var(--fs-sm);
		font-family: var(--font-mono);
		color: var(--color-text-faint);
	}

	.section {
		display: grid;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
	}

	.section h3 {
		margin: 0;
		font-size: var(--fs-base);
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.note-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-1);
	}

	.note-link {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3);
		border-radius: var(--radius-control);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		text-decoration: none;
		color: inherit;
		box-shadow: var(--shadow-card);
		transition:
			border-color var(--dur-ui) var(--ease-out),
			box-shadow var(--dur-ui) var(--ease-out),
			transform var(--dur-ui) var(--ease-out);
	}

	.note-link:hover {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-lift);
		transform: translateY(-1px);
	}

	.note-link.is-read {
		/*
		 * 已读用 opacity 压淡，在浅色主题下方向是对的（往白拉=退后），
		 * 但深色主题下它会往黑拉、和未读的区分变弱。这里可以接受：
		 * 它只是次要状态提示，标题本身仍用 text 档，不承载必须读出的信息。
		 */
		opacity: 0.68;
	}

	.note-title {
		font-size: var(--fs-base);
	}

	.sub {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-sm);
		line-height: 1.7;
		color: var(--color-text-muted);
	}

	.note-meta {
		flex-shrink: 0;
		display: flex;
		gap: var(--space-1);
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
		color: var(--color-text-faint);
		white-space: nowrap;
	}

	/*
	 * 「已读」用强调色，不用成功绿。
	 *
	 * 原来 .badge-read 和 .badge-mastered 都是 --color-ok，只靠 font-weight
	 * 区分 —— 12px 等宽字下那点字重差几乎读不出来，于是「读过了」和
	 * 「题做对了」在列表里长得一样。而这两件事的含金量完全不同：
	 * 前者是自己点的一个按钮，后者是程序判定的结果。
	 *
	 * 绿色在全站的含义是「成绩」，只能留给程序判定的掌握度；
	 * 「已读」是中性事实，归到强调色。这样也和页头那条进度带的分色对上 ——
	 * 同一个状态在两处不同色，那条带子就成了误导。
	 */
	.badge-read {
		color: var(--color-accent);
	}

	.badge-mastered {
		color: var(--color-ok);
		font-weight: 600;
	}

	.badge-learning {
		color: var(--color-warn);
	}

	/* 「关卡」是导向性标记而非状态，用弱化的文字色避免和状态徽章抢色 */
	.badge-level {
		color: var(--color-text-muted);
	}

	.page-foot {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--space-5);
		font-size: var(--fs-base);
	}

	.page-foot a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--color-accent);
		text-decoration: none;
	}

	.page-foot a:hover {
		text-decoration: underline;
	}
</style>
