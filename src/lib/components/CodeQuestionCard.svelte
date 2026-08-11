<script lang="ts">
	/**
	 * 代码题卡片。
	 *
	 * 与数值/选择题的关键差异：判定是异步的，且首次运行要下载约 10MB 的 Python 运行时。
	 * 所以这里的设计重点不是「反馈快于 300ms」（做不到），
	 * 而是**让等待可理解**：说清为什么慢、慢多久、进行到哪一步。
	 *
	 * 三种非正常结局都必须区分清楚，否则用户会误以为是自己写错了：
	 * - error：你的代码报错了
	 * - timeout：跑太久被中断，可能有死循环
	 * - unavailable：运行时下载失败，不是你的问题
	 */
	import { renderInline, renderProse } from '$lib/quiz/inline-markdown';
	import { onMount } from 'svelte';
	import { PythonRunner } from '$lib/python/runner';
	import type { CodeQuestion, CodeRunResult } from '$lib/quiz/types';

	interface Props {
		question: CodeQuestion;
		/** 本题定论时回调一次 */
		onResolved?: (correct: boolean) => void;
		onNext?: () => void;
		showNext?: boolean;
	}

	let { question, onResolved, onNext, showNext = true }: Props = $props();

	let editorHost = $state<HTMLDivElement | null>(null);
	/** CodeMirror 实例。类型用 unknown 因为它是动态 import 的 */
	let editorView: { state: { doc: { toString(): string } }; dispatch(tr: unknown): void } | null =
		null;
	let editorReady = $state(false);
	/** CodeMirror 加载失败时退回 textarea，保证功能可用 */
	let fallbackCode = $state('');
	let useFallback = $state(false);

	let runner: PythonRunner | null = null;
	let running = $state(false);
	let progress = $state('');
	let runtimeReady = $state(false);
	let result = $state<CodeRunResult | null>(null);
	let settled = $state(false);
	let showSolution = $state(false);
	let attempts = $state(0);

	const passedCount = $derived(result?.tests.filter((t) => t.passed).length ?? 0);
	const totalCount = $derived(result?.tests.length ?? question.tests.length);

	/** 只在第一次答错后给提示，与 QuizCard 的节奏一致 */
	const showHint = $derived(attempts >= 1 && !settled && !!question.hint);

	function currentCode(): string {
		if (useFallback) return fallbackCode;
		return editorView?.state.doc.toString() ?? question.starterCode;
	}

	onMount(() => {
		fallbackCode = question.starterCode;

		// 动态 import：CodeMirror 引用 document，静态导入会让预渲染失败
		let disposed = false;
		void (async () => {
			try {
				const [{ EditorView, basicSetup }, { python }, { oneDark }] = await Promise.all([
					import('codemirror'),
					import('@codemirror/lang-python'),
					import('@codemirror/theme-one-dark')
				]);
				if (disposed || !editorHost) return;

				const view = new EditorView({
					doc: question.starterCode,
					extensions: [basicSetup, python(), oneDark],
					parent: editorHost
				});
				editorView = view as unknown as typeof editorView;
				editorReady = true;
			} catch {
				// 编辑器加载失败不该让整道题不能做
				useFallback = true;
				editorReady = true;
			}
		})();

		runner = new PythonRunner({
			onProgress: (detail) => (progress = detail),
			onReady: () => {
				runtimeReady = true;
				progress = '';
			}
		});

		return () => {
			disposed = true;
			runner?.destroy();
			runner = null;
			(editorView as unknown as { destroy?: () => void } | null)?.destroy?.();
		};
	});

	async function run() {
		if (running || !runner) return;
		running = true;
		result = null;
		progress = runtimeReady ? '正在执行' : '正在准备 Python 运行时';

		const outcome = await runner.run(question, currentCode());

		running = false;
		progress = '';
		result = outcome;
		runtimeReady = runner.isReady;

		if (outcome.correct) {
			settled = true;
			onResolved?.(true);
			return;
		}

		// 只有真正跑起来并且判错才计入尝试次数。
		// 运行时下载失败不是用户的错，不该消耗他的机会。
		if (outcome.outcome === 'fail' || outcome.outcome === 'error') {
			attempts += 1;
			if (attempts >= 3) {
				settled = true;
				onResolved?.(false);
			}
		}
	}

	function resetCode() {
		if (useFallback) {
			fallbackCode = question.starterCode;
			return;
		}
		editorView?.dispatch({
			changes: { from: 0, to: currentCode().length, insert: question.starterCode }
		});
	}

	function revealSolution() {
		showSolution = true;
		settled = true;
		onResolved?.(false);
	}

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(currentCode());
			progress = '已复制到剪贴板';
			setTimeout(() => (progress = ''), 1500);
		} catch {
			progress = '复制失败，请手动选择代码';
			setTimeout(() => (progress = ''), 2500);
		}
	}
</script>

<article class="card" data-state={result?.outcome ?? 'idle'}>
	<p class="prompt">{question.prompt}</p>

	{#if question.setupCode}
		<details class="setup">
			<summary>已为你准备好的代码（只读）</summary>
			<pre>{question.setupCode.trim()}</pre>
		</details>
	{/if}

	<div class="editor-wrap">
		{#if useFallback}
			<label class="sr-only" for="code-{question.id}">Python 代码</label>
			<textarea
				id="code-{question.id}"
				class="fallback-editor"
				spellcheck="false"
				bind:value={fallbackCode}
				disabled={settled}></textarea>
		{:else}
			<div class="editor" bind:this={editorHost} data-testid="code-editor"></div>
			{#if !editorReady}
				<p class="editor-loading">正在加载编辑器…</p>
			{/if}
		{/if}
	</div>

	<div class="actions">
		<button class="btn btn-primary" onclick={run} disabled={running || settled}>
			{running ? '运行中…' : '运行并检查'}
		</button>
		<button class="btn btn-ghost" onclick={resetCode} disabled={running || settled}>重置</button>
		{#if !settled && attempts >= 2}
			<button class="btn btn-ghost" onclick={revealSolution}>看参考答案</button>
		{/if}
	</div>

	{#if !runtimeReady && !running && result === null}
		<p class="notice">
			首次运行需要下载约 10 MB 的 Python 运行时（之后会被浏览器缓存）。
			代码在你的浏览器里执行，不会上传到任何服务器。
		</p>
	{/if}

	<div class="feedback" aria-live="polite" data-testid="code-feedback">
		{#if running || progress}
			<p class="progress">
				<span class="spinner" aria-hidden="true"></span>
				{progress || '执行中'}
			</p>
		{/if}

		{#if result}
			{#if result.outcome === 'unavailable'}
				<div class="panel panel-warn">
					<p class="panel-title">Python 运行时加载失败</p>
					<p>
						这不是你代码的问题——运行时从 CDN 下载失败，通常是网络原因。 可以稍后重试，或把代码复制到
						Colab 里跑。
					</p>
					<div class="panel-actions">
						<button class="btn btn-ghost" onclick={copyCode}>复制代码</button>
						<a
							class="btn btn-ghost"
							href="https://colab.research.google.com/#create=true"
							target="_blank"
							rel="noreferrer noopener">在 Colab 打开</a
						>
					</div>
					{#if result.error}<pre class="error-detail">{result.error}</pre>{/if}
				</div>
			{:else if result.outcome === 'timeout'}
				<div class="panel panel-warn">
					<p class="panel-title">执行超时，已中断</p>
					<p>{result.error}</p>
					<p class="dim">运行时已被重置，下次运行会重新加载（约十几秒）。</p>
				</div>
			{:else if result.outcome === 'error'}
				<div class="panel panel-bad">
					<p class="panel-title">代码报错了，测试没能开始</p>
					<pre class="error-detail">{result.error}</pre>
				</div>
			{:else}
				<div class="score" data-testid="code-score">
					<span class={result.correct ? 'score-ok' : 'score-bad'}>
						{passedCount} / {totalCount} 条用例通过
					</span>
					{#if result.durationMs !== undefined}
						<span class="dim">耗时 {result.durationMs} ms</span>
					{/if}
				</div>

				<ul class="cases">
					{#each result.tests as t (t.label)}
						<li class:passed={t.passed}>
							<span class="mark" aria-hidden="true">{t.passed ? '✓' : '✗'}</span>
							<span class="case-body">
								<span class="case-label">{t.label}</span>
								{#if !t.passed && t.message}
									<span class="case-message">{t.message}</span>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if result.stdout.trim() !== ''}
				<details class="stdout" open>
					<summary>你的输出</summary>
					<pre>{result.stdout.trim()}</pre>
				</details>
			{/if}
		{/if}

		{#if showHint}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderInline 已转义 -->
			<p class="hint">💡 {@html renderInline(question.hint ?? '')}</p>
		{/if}

		{#if showSolution}
			<div class="panel panel-solution">
				<p class="panel-title">参考答案</p>
				<pre>{question.solutionCode.trim()}</pre>
			</div>
		{/if}

		{#if settled}
			<div class="explanation">
				<!--
					题库文案含 `**粗体**`、`` `代码` `` 和 ```` ``` ```` 围栏块（全站 91 处），
					此前当纯文本渲染，屏幕上原样显示 `= **5**`——而每道题加粗的那行
					恰好就是答案行。渲染器先转义再替换，顺序不可颠倒。
				-->
				{#each renderProse(question.explanation) as block, i (i)}
					{#if block.kind === 'code'}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderProse 已转义 -->
						<pre class="prose-code"><code>{@html block.html}</code></pre>
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderProse 已转义 -->
						<p>{@html block.html}</p>
					{/if}
				{/each}
			</div>
		{/if}
	</div>

	{#if settled && showNext}
		<div class="actions">
			<button class="btn btn-primary" onclick={() => onNext?.()}>下一题 →</button>
		</div>
	{/if}
</article>

<style>
	.card {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		padding: 1.75rem;
		display: grid;
		gap: 1.25rem;
		transition:
			border-color 180ms ease,
			box-shadow 180ms ease;
	}

	.card[data-state='pass'] {
		border-color: var(--color-ok);
		box-shadow: 0 0 0 1px var(--color-ok);
	}

	.card[data-state='fail'],
	.card[data-state='error'] {
		border-color: var(--color-bad);
	}

	.card[data-state='timeout'],
	.card[data-state='unavailable'] {
		border-color: var(--color-warn);
	}

	.prompt {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.7;
		white-space: pre-wrap;
	}

	.setup {
		background: var(--color-surface-sunken);
		border-radius: 8px;
		padding: 0.625rem 0.875rem;
		font-size: 0.875rem;
	}

	.setup summary {
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.editor-wrap {
		position: relative;
	}

	.editor {
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		overflow: hidden;
		min-height: 8rem;
	}

	/* CodeMirror 的滚动容器需要显式高度上限，否则长代码会把页面撑开 */
	.editor :global(.cm-editor) {
		max-height: 26rem;
		font-size: 0.875rem;
	}

	.editor :global(.cm-scroller) {
		font-family: var(--font-mono);
	}

	.editor :global(.cm-editor.cm-focused) {
		outline: 2px solid var(--color-accent);
		outline-offset: -1px;
	}

	.editor-loading {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
	}

	.fallback-editor {
		width: 100%;
		min-height: 12rem;
		background: var(--color-surface-sunken);
		color: inherit;
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		padding: 0.875rem;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		line-height: 1.6;
		resize: vertical;
		box-sizing: border-box;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.notice {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--color-text-muted);
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border-radius: 8px;
	}

	.feedback:empty {
		display: none;
	}

	.feedback {
		display: grid;
		gap: 1rem;
	}

	.progress {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		color: var(--color-accent);
	}

	.spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid color-mix(in oklch, var(--color-accent) 30%, transparent);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 700ms linear infinite;
		flex: 0 0 auto;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.score {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		font-weight: 600;
		font-family: var(--font-mono);
	}

	.score-ok {
		color: var(--color-ok);
	}
	.score-bad {
		color: var(--color-bad);
	}

	.dim {
		font-weight: 400;
		font-size: 0.8125rem;
		color: var(--color-text-faint);
		font-family: var(--font-sans);
	}

	.cases {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.cases li {
		display: flex;
		gap: 0.625rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface-sunken);
		border-radius: 8px;
		border-left: 2px solid var(--color-bad);
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.cases li.passed {
		border-left-color: var(--color-ok);
	}

	.mark {
		flex: 0 0 auto;
		font-family: var(--font-mono);
		color: var(--color-bad);
	}

	.cases li.passed .mark {
		color: var(--color-ok);
	}

	.case-body {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.case-message {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-bad-text-strong);
		word-break: break-word;
	}

	.panel {
		padding: 0.875rem 1rem;
		border-radius: 9px;
		background: var(--color-surface-sunken);
		display: grid;
		gap: 0.5rem;
		font-size: 0.9375rem;
		line-height: 1.7;
	}

	.panel p {
		margin: 0;
	}

	.panel-title {
		font-weight: 600;
	}

	.panel-warn {
		border-left: 2px solid var(--color-warn);
	}
	.panel-warn .panel-title {
		color: var(--color-warn);
	}

	.panel-bad {
		border-left: 2px solid var(--color-bad);
	}
	.panel-bad .panel-title {
		color: var(--color-bad);
	}

	.panel-solution {
		border-left: 2px solid var(--color-accent);
	}
	.panel-solution .panel-title {
		color: var(--color-accent);
	}

	.panel-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.25rem;
	}

	pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--color-text);
	}

	.error-detail {
		background: var(--color-surface);
		padding: 0.625rem 0.75rem;
		border-radius: 6px;
		color: var(--color-bad-text);
	}

	.stdout {
		background: var(--color-surface-sunken);
		border-radius: 8px;
		padding: 0.625rem 0.875rem;
		font-size: 0.875rem;
	}

	.stdout summary {
		cursor: pointer;
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	.hint {
		margin: 0;
		padding: 0.75rem 0.875rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		line-height: 1.7;
		background: color-mix(in oklch, var(--color-warn) 10%, var(--color-surface-sunken));
		border-left: 2px solid var(--color-warn);
	}

	/* explanation 里的参考解法代码块。不做语法高亮：关卡页不加载 highlight.js */
	.prose-code {
		margin: 0.75rem 0;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border-radius: 8px;
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.6;
	}

	.explanation :global(code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
		padding: 0.0625rem 0.25rem;
		border-radius: 4px;
		background: var(--color-surface-sunken);
	}

	.explanation :global(strong) {
		color: var(--color-text-strong);
	}

	.explanation {
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-accent);
		border-radius: 8px;
		padding: 1rem 1.125rem;
		display: grid;
		gap: 0.75rem;
		font-size: 0.9375rem;
		line-height: 1.75;
	}

	.explanation p {
		margin: 0;
		white-space: pre-wrap;
	}

	.btn {
		font: inherit;
		font-size: 0.9375rem;
		padding: 0.5rem 1.0625rem;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
	}

	.btn:disabled {
		/* 显式取值而不是 opacity，理由见 layout.css 的 --color-disabled-surface */
		background: var(--color-disabled-surface);
		color: var(--color-disabled-text);
		border-color: transparent;
		cursor: not-allowed;
	}

	.btn-primary {
		background: var(--color-accent);
		color: var(--color-surface-code);
		font-weight: 600;
	}

	.btn-ghost {
		background: transparent;
		color: var(--color-accent);
		border-color: var(--color-border-subtle);
	}

	.btn-ghost:hover {
		border-color: var(--color-accent);
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
</style>
