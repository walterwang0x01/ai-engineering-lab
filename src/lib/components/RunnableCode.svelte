<script lang="ts">
	/**
	 * 把笔记正文里已渲染的 Python 代码块升级成「可改可跑」。
	 *
	 * ## 为什么用渐进增强，而不是在 markdown 里加标记
	 *
	 * 笔记 markdown 在另一个仓库（稀疏检出进来的），逐篇加标记的成本要乘以 168。
	 * 而渲染后的 HTML 里 `<pre><code class="language-python">` 本身就是可靠锚点——
	 * 一次改动覆盖全站 578 个 python 块，笔记源文件一个字都不用动。
	 *
	 * ## 为什么复用 PythonRunner 而不新写执行器
	 *
	 * `runner.run()` 只读 question 的 setupCode / tests / packages 三个字段，
	 * 传 `tests: []` 就退化成纯执行器。关卡代码题和这里共用同一个 Worker 协议、
	 * 同一套超时熔断（首次 75s 含加载、之后 15s）、同一个死循环 terminate 策略。
	 * 另写一份会让两处的超时行为悄悄漂移。
	 *
	 * ## Pyodide 必须严格懒加载（AGENTS.md 第 12 条）
	 *
	 * Pyodide 核心约 10MB。这里**只在用户点「运行」时**才 new PythonRunner，
	 * 纯阅读的人完全不碰它。不要在挂载时 warmup——那等于把 10MB 强加给只想读的人。
	 */
	import { onMount } from 'svelte';
	import type { PythonRunner as RunnerType } from '$lib/python/runner';
	import type { CodeQuestion } from '$lib/quiz/types';

	type Props = {
		/** 正文容器。挂载后在其中查找 python 代码块 */
		container: HTMLElement | null;
	};

	let { container }: Props = $props();

	/**
	 * Svelte action：把 Svelte 自己创建的节点搬进 `{@html}` 渲染出的挂载点。
	 *
	 * 这样做而不用 portal 库：节点仍然由 Svelte 拥有，响应式和事件绑定都照常工作，
	 * 只是物理位置在正文流里。销毁时把节点摘掉，避免 `{@html}` 重渲染后留下孤儿。
	 */
	function mountInto(node: HTMLElement, target: HTMLElement) {
		target.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	/** 每个被增强的块一份状态，按块序号索引 */
	type BlockState = {
		code: string;
		original: string;
		running: boolean;
		stdout: string;
		error: string;
		ran: boolean;
		/** 是否已切到编辑态。默认 false——先让读者读，改是可选动作 */
		editing: boolean;
		/** 对应的原始 <pre>，进编辑态时隐藏它，避免同一段代码显示两遍 */
		pre: HTMLElement | null;
	};

	let blocks = $state<BlockState[]>([]);
	let runner: RunnerType | null = null;
	let loadingRuntime = $state(false);

	/**
	 * Pyodide 环境里可用的模块：Python 标准库 + 同源同步进来的 numpy。
	 *
	 * 用**白名单**而不是第三方黑名单。黑名单漏一个就把跑不了的块判成能跑，
	 * 而这类漏洞很难自查——写 `langchain\b` 匹配不到 `langchain_openai`
	 * （下划线是词字符，`\b` 不成立）就是本轮踩到的实例。
	 * 白名单的失败方向是安全的：漏了某个标准库只会少给一个运行按钮。
	 */
	const AVAILABLE = new Set([
		'numpy',
		'json',
		'math',
		're',
		'os',
		'sys',
		'time',
		'random',
		'collections',
		'itertools',
		'functools',
		'dataclasses',
		'typing',
		'datetime',
		'hashlib',
		'base64',
		'decimal',
		'enum',
		'abc',
		'textwrap',
		'string',
		'heapq',
		'bisect',
		'copy',
		'statistics',
		'uuid',
		'pathlib',
		'io',
		'csv',
		'struct',
		'binascii',
		'hmac',
		'secrets',
		'unicodedata',
		'difflib',
		'pprint',
		'operator',
		'contextlib',
		'warnings'
	]);

	/**
	 * 跑不出结果的用法：要网络、要凭证、要文件、要事件循环。
	 * 浏览器里的 Pyodide 没有网络栈也没有这些凭证——
	 * **给一个必然失败的运行按钮比不给按钮更糟**，它会让读者以为站点坏了。
	 */
	const NEEDS_WORLD =
		/\b(?:urllib|socket|subprocess|os\.environ|getenv|api_key|API_KEY|await\s|async\s+def|asyncio|input\s*\(\s*\)|open\s*\(\s*['"])/;

	/** 这段代码能否在浏览器里真跑出东西 */
	function canRun(code: string): boolean {
		// 没有 print 的块跑完看不见效果，不给按钮
		if (!/\bprint\s*\(/.test(code)) return false;
		if (NEEDS_WORLD.test(code)) return false;

		// 用数组收集而不是 Set：ESLint 的 svelte/prefer-svelte-reactivity 会要求
		// 组件里的 Set 换成 SvelteSet，而这里只是一次性的局部集合，不需要响应式。
		const mods: string[] = [];
		for (const m of code.matchAll(/^\s*import\s+([\w.]+)/gm)) mods.push(m[1].split('.')[0]);
		for (const m of code.matchAll(/^\s*from\s+([\w.]+)\s+import/gm)) mods.push(m[1].split('.')[0]);
		return mods.every((m) => AVAILABLE.has(m));
	}

	/** 这段代码是否需要加载 numpy（决定要不要声明 packages） */
	function needsNumpy(code: string): boolean {
		return /^\s*(?:import|from)\s+numpy\b/m.test(code);
	}

	onMount(() => {
		if (!container) return;

		const pres = [...container.querySelectorAll('pre')].filter((pre) =>
			pre.querySelector('code.language-python')
		);
		if (pres.length === 0) return;

		// 只增强能真正跑出结果的块
		const runnablePres = pres.filter((pre) => canRun(pre.textContent ?? ''));
		skipped = pres.length - runnablePres.length;
		if (runnablePres.length === 0) {
			hostsReady = true;
			return;
		}

		blocks = runnablePres.map((pre) => {
			const code = pre.textContent ?? '';
			return {
				code,
				original: code,
				running: false,
				stdout: '',
				error: '',
				ran: false,
				editing: false,
				pre: pre as HTMLElement
			};
		});

		runnablePres.forEach((pre, i) => {
			const host = document.createElement('div');
			host.className = 'runnable-host';
			host.dataset.blockIndex = String(i);
			pre.insertAdjacentElement('afterend', host);
			hosts[i] = host;
		});
		hostsReady = true;

		return () => runner?.destroy();
	});

	let hosts: HTMLElement[] = [];
	let hostsReady = $state(false);
	/** 因依赖外部服务或第三方库而未提供运行的块数 */
	let skipped = $state(0);

	async function run(i: number) {
		const b = blocks[i];
		if (!b || b.running) return;
		b.running = true;
		b.error = '';
		b.stdout = '';

		if (!runner) {
			loadingRuntime = true;
			const { PythonRunner } = await import('$lib/python/runner');
			runner = new PythonRunner({
				onReady: () => (loadingRuntime = false)
			});
		}

		// tests: [] 让 run() 退化成纯执行器——只要 stdout，不做判定。
		// packages 只在代码真的 import numpy 时才声明：无谓地声明会让每次运行都
		// 多等一次 loadPackage 的检查，也会让首次加载多拉 2.9MB。
		const scratch: CodeQuestion = {
			kind: 'code',
			id: `note-block-${i}`,
			prompt: '',
			starterCode: '',
			setupCode: '',
			packages: needsNumpy(b.code) ? ['numpy'] : [],
			tests: [],
			explanation: '',
			solutionCode: ''
		};
		const result = await runner.run(scratch, b.code);
		loadingRuntime = false;
		b.running = false;
		b.ran = true;
		b.stdout = result.stdout ?? '';
		if (result.error) b.error = result.error;
	}

	function reset(i: number) {
		const b = blocks[i];
		if (!b) return;
		b.code = b.original;
		b.stdout = '';
		b.error = '';
		b.ran = false;
	}

	/**
	 * 切进/退出编辑态。
	 *
	 * 进编辑态时隐藏原始 `<pre>`：否则同一段代码在页面上出现两遍，
	 * 既占竖向空间，也让读者不确定该看哪一份、改的是哪一份。
	 * 退出时若代码被改过就保留改动（只是折叠起来），不悄悄丢用户输入。
	 */
	function toggleEdit(i: number) {
		const b = blocks[i];
		if (!b) return;
		b.editing = !b.editing;
		if (b.pre) b.pre.style.display = b.editing ? 'none' : '';
	}
</script>

{#if hostsReady}
	{#if skipped > 0 && blocks.length === 0}
		<!--
			全部代码块都依赖第三方库时，给一句说明而不是静默什么都不做——
			否则读者在别的笔记见过运行按钮，到这里会以为是坏了。
		-->
		<p class="rb-unavailable">
			这篇的代码要调用外部服务或用到浏览器里没有的库，所以没有提供「运行」。复制到本地跑即可。
		</p>
	{/if}
	{#each blocks as b, i (i)}
		{#if hosts[i]}
			<!--
				用 Svelte 的 {@attach}-free 做法：把控件渲染到正文里的挂载点。
				这里靠一个隐藏容器 + appendChild 迁移，避免引入 portal 依赖。
			-->
			<div class="runnable" data-for={i} use:mountInto={hosts[i]}>
				<div class="rb-bar">
					<button
						type="button"
						class="rb-run"
						onclick={() => run(i)}
						disabled={b.running || loadingRuntime}
					>
						{b.running ? '运行中…' : b.ran ? '再跑一次' : '▶ 运行这段'}
					</button>
					{#if b.code !== b.original}
						<button type="button" class="rb-reset" onclick={() => reset(i)}>还原</button>
					{/if}
					<button type="button" class="rb-reset" onclick={() => toggleEdit(i)}>
						{b.editing ? '收起编辑' : '改一改'}
					</button>
					{#if loadingRuntime && b.running}
						<span class="rb-note">首次运行要下载 Python 运行时（约 10MB）</span>
					{/if}
				</div>

				{#if b.editing}
					<label class="sr-only" for="edit-{i}">编辑这段代码</label>
					<textarea
						id="edit-{i}"
						class="rb-edit"
						bind:value={b.code}
						spellcheck="false"
						rows={Math.min(24, b.code.split('\n').length + 1)}></textarea>
				{/if}

				{#if b.ran}
					<div class="rb-out" class:rb-out-err={!!b.error}>
						{#if b.error}
							<pre class="rb-pre">{b.error}</pre>
						{:else if b.stdout.trim()}
							<pre class="rb-pre">{b.stdout}</pre>
						{:else}
							<p class="rb-empty">运行完成，没有输出。加一句 <code>print(...)</code> 看看结果。</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
{/if}

<style>
	.runnable {
		display: grid;
		gap: 0.625rem;
		margin: -0.5rem 0 1.5rem;
	}

	.rb-bar {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.rb-run,
	.rb-reset {
		min-height: 36px;
		padding: 0 0.875rem;
		border-radius: var(--radius-control);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background-color var(--dur-verdict) var(--ease-out),
			border-color var(--dur-verdict) var(--ease-out);
	}

	.rb-run {
		background: var(--color-accent);
		color: var(--color-on-accent);
		border: 1px solid transparent;
	}

	.rb-run:disabled {
		background: var(--color-disabled-surface);
		color: var(--color-disabled-text);
		cursor: not-allowed;
	}

	.rb-reset {
		background: transparent;
		color: var(--color-text-soft);
		border: 1px solid var(--color-border-strong);
	}

	.rb-note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.rb-edit {
		width: 100%;
		box-sizing: border-box;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-control);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.65;
		resize: vertical;
	}

	.rb-out {
		padding: 0.875rem 1rem;
		background: var(--color-surface-inset);
		border-left: 2px solid var(--color-ok);
		border-radius: var(--radius-control);
	}

	.rb-out-err {
		border-left-color: var(--color-bad);
	}

	.rb-pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.6;
		white-space: pre-wrap;
		color: var(--color-text);
	}

	.rb-out-err .rb-pre {
		color: var(--color-bad-text);
	}

	.rb-empty {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.rb-unavailable {
		margin: 0 0 1.5rem;
		padding: 0.75rem 0.9375rem;
		background: var(--color-surface-inset);
		border-left: 2px solid var(--color-border-strong);
		border-radius: var(--radius-control);
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--color-text-soft);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
