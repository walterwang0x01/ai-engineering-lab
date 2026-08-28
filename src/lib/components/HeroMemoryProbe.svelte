<script lang="ts">
	/**
	 * 首屏的可动手部件。
	 *
	 * ## 为什么首页需要它
	 *
	 * 改版前首屏是纯文字堆叠：标题、导语、四个数字、两个按钮。整站的卖点是
	 * 「调参数能看到约束怎么被打破」，而首屏**没有任何东西可以调**——
	 * 读者只能读到这句承诺，不能验证它。这是首页最大的设计缺陷，
	 * 比字号层级更根本：它让一个交互式练习场看起来像一篇说明文。
	 *
	 * 所以这里不是装饰性插图，而是把全站的核心循环压缩成一屏能碰的东西：
	 * 拖参数 → 数字实时变 → 越过约束线立刻变红并说明原因。
	 *
	 * ## 为什么选「显存够不够」这个题
	 *
	 * 它是本站 5 个沙盒里最能一句话说清、且结论最反直觉的一个：
	 * 上下文长度对显存是**线性**放大，而人的直觉往往以为「长一点没多少」。
	 * 4K→64K 只是 16 倍上下文，KV Cache 却从 40 GB 涨到 640 GB，
	 * 直接吃掉整个 8 卡节点——这个跳变亲手拖一次比读三段解释有效。
	 *
	 * ## 数字的来源
	 *
	 * 全部与 `kv-cache-questions.ts` / `deploy-decision-questions.ts` 同源，
	 * 用的是 Llama 2 70B 的真实配置。公式：
	 *   KV bytes = 2(K和V) × batch × seq × layers × kv_heads × head_dim × 每元素字节
	 * GQA 下 kv_heads = 组数 = 8（不是 64 个查询头，这是最常见的算错点）。
	 *
	 * 权重固定按 fp16 的 130.4 GiB 计——精度滑块只作用于 KV Cache，
	 * 因为 KV 量化和权重量化是两件不同的工程决策，混在一个控件里会教错。
	 */

	/** Llama 2 70B 真实配置，与题库同源 */
	const MODEL = {
		layers: 80,
		kvHeads: 8,
		headDim: 128,
		/** fp16 权重，GiB */
		weightGiB: 130.4
	} as const;

	/** 8 × A100 80GB */
	const CAPACITY_GIB = 640;

	const PRECISIONS = [
		{ id: 'fp16', label: 'fp16', bytes: 2 },
		{ id: 'int8', label: 'INT8', bytes: 1 },
		{ id: 'int4', label: 'INT4', bytes: 0.5 }
	] as const;

	/** 上下文档位。用离散档而不是连续滑动：这些是真实模型的上下文规格 */
	const CONTEXTS = [4096, 8192, 16384, 32768, 65536, 131072] as const;

	let batch = $state(32);
	/** CONTEXTS 的下标。range input 只能给连续值，所以滑下标 */
	let ctxIndex = $state(0);
	let precisionId = $state<(typeof PRECISIONS)[number]['id']>('fp16');

	const seqLen = $derived(CONTEXTS[ctxIndex]);
	const precision = $derived(PRECISIONS.find((p) => p.id === precisionId) ?? PRECISIONS[0]);

	const kvGiB = $derived(
		(2 * batch * seqLen * MODEL.layers * MODEL.kvHeads * MODEL.headDim * precision.bytes) /
			1024 ** 3
	);
	const totalGiB = $derived(MODEL.weightGiB + kvGiB);
	const fits = $derived(totalGiB <= CAPACITY_GIB);
	/** 进度条宽度，超出后钉在 100% —— 超出量由文字说明，不靠溢出的条表达 */
	const fillPct = $derived(Math.min(100, (totalGiB / CAPACITY_GIB) * 100));
	const overBy = $derived(Math.max(0, totalGiB - CAPACITY_GIB));

	function fmt(n: number): string {
		if (n >= 100) return Math.round(n).toLocaleString('en-US');
		return n.toFixed(1);
	}

	function fmtCtx(n: number): string {
		return n >= 1024 ? `${n / 1024}K` : String(n);
	}
</script>

<figure class="probe" data-testid="hero-probe">
	<figcaption class="head">
		<span class="eyebrow">先动手</span>
		<h2>Llama 2 70B 放得进 8 张 A100 吗</h2>
		<p>拖动参数，看约束什么时候被打破——站里每一关都是这个做法。</p>
	</figcaption>

	<div class="controls">
		<label class="ctrl">
			<span class="ctrl-label">
				并发 batch
				<output>{batch}</output>
			</span>
			<!--
				给控件一个**稳定**的 aria-label，而不是靠可见标签关联。
				可见标签里含实时数值（「并发 batch 32」），读屏器每拖一格都会把
				标签连着数字整句重读，噪音大到没法用；当前值交给 range 自身的
				aria-valuenow 播报就够了。
			-->
			<input
				type="range"
				min="1"
				max="64"
				step="1"
				bind:value={batch}
				aria-label="并发 batch"
				data-testid="probe-batch"
			/>
		</label>

		<label class="ctrl">
			<span class="ctrl-label">
				上下文长度
				<output>{fmtCtx(seqLen)}</output>
			</span>
			<!--
				滑的是档位下标，所以必须给 aria-valuetext —— 否则读屏器播报的是
				「3」这个下标，而不是用户真正在选的「32K」。
			-->
			<input
				type="range"
				min="0"
				max={CONTEXTS.length - 1}
				step="1"
				bind:value={ctxIndex}
				aria-label="上下文长度"
				aria-valuetext={fmtCtx(seqLen)}
				data-testid="probe-context"
			/>
		</label>

		<fieldset class="ctrl seg-wrap">
			<legend class="ctrl-label">KV Cache 精度</legend>
			<div class="seg">
				{#each PRECISIONS as p (p.id)}
					<label class="seg-item" class:on={precisionId === p.id}>
						<input type="radio" name="precision" value={p.id} bind:group={precisionId} />
						<span>{p.label}</span>
					</label>
				{/each}
			</div>
		</fieldset>
	</div>

	<div class="readout">
		<div class="figures">
			<div class="fig">
				<span class="fig-n" class:bad={!fits} data-testid="probe-total">{fmt(totalGiB)}</span>
				<span class="fig-u">GiB 总需求</span>
			</div>
			<div class="fig quiet">
				<span class="fig-n" data-testid="probe-kv">{fmt(kvGiB)}</span>
				<span class="fig-u">GiB 其中 KV Cache</span>
			</div>
			<div class="fig quiet">
				<span class="fig-n">{CAPACITY_GIB}</span>
				<span class="fig-u">GiB 可用显存</span>
			</div>
		</div>

		<div class="bar" role="img" aria-label="显存占用 {fmt(totalGiB)} GiB，容量 {CAPACITY_GIB} GiB">
			<div class="fill" class:bad={!fits} style="width: {fillPct}%"></div>
		</div>

		<p class="verdict" class:bad={!fits} aria-live="polite">
			{#if fits}
				放得下 · 还剩 {fmt(CAPACITY_GIB - totalGiB)} GiB 余量
			{:else}
				放不下 · 超出 {fmt(overBy)} GiB，得砍 batch、缩上下文或量化 KV
			{/if}
		</p>
	</div>
</figure>

<style>
	.probe {
		margin: 0;
		padding: var(--space-5);
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-shell);
		box-shadow: var(--shadow-card);
		display: grid;
		gap: var(--space-5);
	}

	.head {
		display: grid;
		gap: var(--space-1);
	}

	.eyebrow {
		font-size: var(--fs-2xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-accent);
	}

	.head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--color-text-strong);
		line-height: 1.3;
	}

	.head p {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
		line-height: 1.6;
	}

	.controls {
		display: grid;
		gap: var(--space-4);
	}

	.ctrl {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	.ctrl-label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--fs-sm);
		color: var(--color-text-soft);
		padding: 0;
	}

	.ctrl-label output {
		font-family: var(--font-mono);
		font-size: var(--fs-base);
		font-weight: 600;
		color: var(--color-text-strong);
	}

	input[type='range'] {
		width: 100%;
		/* 44px 触摸目标：滑块本身视觉上细，但可点区域要够 */
		min-height: 44px;
		accent-color: var(--color-accent);
	}

	/* ── 精度分段控件 ── */
	.seg-wrap {
		min-width: 0;
	}

	.seg {
		display: flex;
		gap: var(--space-1);
		padding: var(--space-1);
		background: var(--color-surface-inset);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-control);
	}

	.seg-item {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		border-radius: calc(var(--radius-control) - 2px);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background var(--dur-verdict) var(--ease-out),
			color var(--dur-verdict) var(--ease-out);
	}

	/* 单选框本身隐藏但保留可聚焦与可读——不用 display:none，那会让键盘拿不到它 */
	.seg-item input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.seg-item.on {
		background: var(--color-surface-raised);
		color: var(--color-text-strong);
		box-shadow: var(--shadow-card);
	}

	/* 焦点环要跟着隐藏的 radio 走，否则键盘用户看不到自己在哪 */
	.seg-item:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	/* ── 读数 ── */
	.readout {
		display: grid;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border-subtle);
	}

	.figures {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
	}

	.fig {
		display: grid;
		gap: var(--space-1);
	}

	.fig-n {
		font-family: var(--font-mono);
		font-size: var(--fs-xl);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
		color: var(--color-text-strong);
		/* 数字变化时的色彩过渡要快于 300ms，否则失去「击中感」 */
		transition: color var(--dur-verdict) var(--ease-out);
	}

	.fig-n.bad {
		color: var(--color-bad);
	}

	.fig.quiet .fig-n {
		font-size: var(--fs-lg);
		color: var(--color-text-muted);
	}

	.fig-u {
		font-size: var(--fs-2xs);
		color: var(--color-text-faint);
	}

	.bar {
		height: 10px;
		background: var(--color-track);
		border-radius: 999px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--color-ok);
		border-radius: 999px;
		transition:
			width var(--dur-ui) var(--ease-out),
			background var(--dur-verdict) var(--ease-out);
	}

	.fill.bad {
		background: var(--color-bad);
	}

	.verdict {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--color-ok);
	}

	.verdict.bad {
		color: var(--color-bad);
	}

	@media (min-width: 48rem) {
		.controls {
			grid-template-columns: 1fr 1fr auto;
			align-items: end;
			gap: var(--space-5);
		}
	}
</style>
