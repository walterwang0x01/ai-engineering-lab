<script lang="ts">
	/**
	 * KV Cache 容量规划沙盒。
	 *
	 * 这是从「回答问题」到「达成目标」的跃迁：给定双重约束，
	 * 用户自己调参数找可行解。判定是纯算术，不需要后端。
	 *
	 * 关卡设计经过验证：12 个配置组合中恰好 3 个达标，
	 * 失败原因在「显存超」与「质量超」两侧均衡分布，
	 * 所以用户无法靠「一路选最省的」通关 —— 必须理解权衡。
	 */

	interface Props {
		onSolved?: () => void;
	}
	let { onSolved }: Props = $props();

	/** Llama 2 70B 的真实配置 */
	const MODEL = {
		label: 'Llama 2 70B',
		layers: 80,
		heads: 64,
		headDim: 128
	} as const;

	/** 固定的服务场景参数 */
	const WORKLOAD = { batch: 32, seqLen: 4096 } as const;

	/** 双重约束 */
	const BUDGET = { memoryGiB: 45, qualityLossPct: 2.0 } as const;

	/**
	 * 质量损失是**示意性估算**，用于体现权衡的量级关系，
	 * 不是某次具体评测的测量值。真实损失依赖模型、任务和校准数据。
	 */
	const ATTENTION_OPTIONS = [
		{ id: 'mha', label: 'MHA', detail: '64 个 KV 头', kvHeads: 64, qualityLoss: 0 },
		{ id: 'gqa16', label: 'GQA 16', detail: '16 组', kvHeads: 16, qualityLoss: 0.3 },
		{ id: 'gqa8', label: 'GQA 8', detail: '8 组', kvHeads: 8, qualityLoss: 0.6 },
		{ id: 'mqa', label: 'MQA', detail: '1 组共享', kvHeads: 1, qualityLoss: 2.5 }
	] as const;

	const PRECISION_OPTIONS = [
		{ id: 'fp16', label: 'fp16', bytes: 2, qualityLoss: 0 },
		{ id: 'int8', label: 'int8', bytes: 1, qualityLoss: 0.4 },
		{ id: 'int4', label: 'int4', bytes: 0.5, qualityLoss: 2.0 }
	] as const;

	let attnId = $state<string>('mha');
	let precId = $state<string>('fp16');
	/** 是否已经达标过，用于只回调一次 */
	let solvedOnce = $state(false);

	const attn = $derived(ATTENTION_OPTIONS.find((o) => o.id === attnId)!);
	const prec = $derived(PRECISION_OPTIONS.find((o) => o.id === precId)!);

	/** KV Cache 显存：2(K和V) × batch × seq × layers × kv_heads × head_dim × bytes */
	const memoryGiB = $derived(
		(2 *
			WORKLOAD.batch *
			WORKLOAD.seqLen *
			MODEL.layers *
			attn.kvHeads *
			MODEL.headDim *
			prec.bytes) /
			1024 ** 3
	);

	const qualityLossPct = $derived(attn.qualityLoss + prec.qualityLoss);

	const memoryOk = $derived(memoryGiB < BUDGET.memoryGiB);
	const qualityOk = $derived(qualityLossPct < BUDGET.qualityLossPct);
	const solved = $derived(memoryOk && qualityOk);

	/** 相对 MHA + fp16 基线节省了多少倍 */
	const baselineGiB = $derived(
		(2 * WORKLOAD.batch * WORKLOAD.seqLen * MODEL.layers * MODEL.heads * MODEL.headDim * 2) /
			1024 ** 3
	);
	const savingsX = $derived(baselineGiB / memoryGiB);

	$effect(() => {
		if (solved && !solvedOnce) {
			solvedOnce = true;
			onSolved?.();
		}
	});

	/** 进度条填充比例，超出预算时按预算封顶以保持可读 */
	function barPct(value: number, budget: number): number {
		return Math.min(100, (value / budget) * 100);
	}

	function fmt(n: number): string {
		return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
	}
</script>

<section class="sandbox" data-solved={solved} aria-labelledby="sandbox-title">
	<header class="head">
		<h3 id="sandbox-title">🎯 关卡：让 70B 在预算内服务 32 并发</h3>
		<p class="scenario">
			{MODEL.label} · {MODEL.layers} 层 · {MODEL.heads} 头 · head_dim {MODEL.headDim}
			<br />
			batch = {WORKLOAD.batch} · seq_len = {WORKLOAD.seqLen}
		</p>
		<p class="goal">
			同时满足两个约束：<b>KV Cache &lt; {BUDGET.memoryGiB} GB</b> 且
			<b>质量损失 &lt; {BUDGET.qualityLossPct}%</b>
		</p>
	</header>

	<div class="controls">
		<fieldset>
			<legend>注意力结构</legend>
			<div class="chips">
				{#each ATTENTION_OPTIONS as opt (opt.id)}
					<label class="chip">
						<input type="radio" name="attn" value={opt.id} bind:group={attnId} />
						<span class="chip-label">{opt.label}</span>
						<span class="chip-detail">{opt.detail}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<fieldset>
			<legend>KV Cache 精度</legend>
			<div class="chips">
				{#each PRECISION_OPTIONS as opt (opt.id)}
					<label class="chip">
						<input type="radio" name="prec" value={opt.id} bind:group={precId} />
						<span class="chip-label">{opt.label}</span>
						<span class="chip-detail">{opt.bytes} byte/元素</span>
					</label>
				{/each}
			</div>
		</fieldset>
	</div>

	<div class="gauges" aria-live="polite">
		<div class="gauge" data-ok={memoryOk}>
			<div class="gauge-head">
				<span class="gauge-name">KV Cache 显存</span>
				<span class="gauge-value" data-testid="memory-value">{fmt(memoryGiB)} GB</span>
			</div>
			<div class="track">
				<div class="fill" style="width: {barPct(memoryGiB, BUDGET.memoryGiB)}%"></div>
			</div>
			<div class="gauge-foot">
				<span>预算 {BUDGET.memoryGiB} GB</span>
				<span class="verdict">
					{memoryOk ? '在预算内' : `超出 ${fmt(memoryGiB - BUDGET.memoryGiB)} GB`}
				</span>
			</div>
		</div>

		<div class="gauge" data-ok={qualityOk}>
			<div class="gauge-head">
				<span class="gauge-name">质量损失（估算）</span>
				<span class="gauge-value" data-testid="quality-value">{qualityLossPct.toFixed(1)}%</span>
			</div>
			<div class="track">
				<div class="fill" style="width: {barPct(qualityLossPct, BUDGET.qualityLossPct)}%"></div>
			</div>
			<div class="gauge-foot">
				<span>预算 {BUDGET.qualityLossPct}%</span>
				<span class="verdict">
					{qualityOk ? '可接受' : `超出 ${(qualityLossPct - BUDGET.qualityLossPct).toFixed(1)}%`}
				</span>
			</div>
		</div>
	</div>

	<div class="readout">
		<code>
			2 × {WORKLOAD.batch} × {WORKLOAD.seqLen} × {MODEL.layers} × <b>{attn.kvHeads}</b> × {MODEL.headDim}
			× <b>{prec.bytes}</b> B = {fmt(memoryGiB)} GB
		</code>
		<p class="savings">
			{#if savingsX > 1.01}
				相比 MHA + fp16 基线（{fmt(baselineGiB)} GB）节省
				<b>{savingsX.toFixed(1)}×</b>
			{:else}
				这就是未做任何优化的 MHA + fp16 基线
			{/if}
		</p>
	</div>

	<div class="status" role="status">
		{#if solved}
			<p class="status-ok">
				✅ 达标。这个配置可以上生产。
				<br />
				注意可行解不止一个——试试还有哪些组合也能过，以及为什么「一路选最省的」反而不行。
			</p>
		{:else if !memoryOk && !qualityOk}
			<p class="status-bad">两个约束都没满足。先解决显存，再回头看质量。</p>
		{:else if !memoryOk}
			<p class="status-bad">
				显存超了。减少 KV 头数或降低精度都能压显存——但注意质量预算还剩
				{(BUDGET.qualityLossPct - qualityLossPct).toFixed(1)}%。
			</p>
		{:else}
			<p class="status-bad">
				显存够了，但质量损失超标。你压得太狠了——往回退一档，显存还有
				{fmt(BUDGET.memoryGiB - memoryGiB)} GB 余量。
			</p>
		{/if}
	</div>

	<p class="disclaimer">
		显存数值是精确计算。质量损失是<b>示意性估算</b>，用于体现权衡的量级关系，
		不代表某次具体评测结果——真实损失取决于模型、任务和校准数据。
	</p>
</section>

<style>
	.sandbox {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		padding: 1.75rem;
		display: grid;
		gap: 1.5rem;
		transition:
			border-color 180ms ease,
			box-shadow 180ms ease;
	}

	.sandbox[data-solved='true'] {
		border-color: var(--color-ok);
		box-shadow: 0 0 0 1px var(--color-ok);
	}

	.head {
		display: grid;
		gap: 0.625rem;
	}

	h3 {
		margin: 0;
		font-size: 1.125rem;
	}

	.scenario {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.7;
		color: oklch(0.68 0.01 260);
	}

	.goal {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.7;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-accent);
		border-radius: 8px;
	}

	.controls {
		display: grid;
		gap: 1.125rem;
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}

	legend {
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.68 0.01 260);
		margin-bottom: 0.5rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.chip {
		display: grid;
		gap: 0.125rem;
		padding: 0.5rem 0.875rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		cursor: pointer;
		transition: border-color 140ms ease;
		min-width: 6.5rem;
	}

	.chip:hover {
		border-color: var(--color-accent-dim);
	}

	.chip input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.chip:has(input:checked) {
		border-color: var(--color-accent);
		background: color-mix(in oklch, var(--color-accent) 12%, var(--color-surface-sunken));
	}

	.chip:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.chip-label {
		font-weight: 600;
		font-size: 0.9375rem;
	}

	.chip-detail {
		font-size: 0.75rem;
		color: oklch(0.66 0.01 260);
	}

	.gauges {
		display: grid;
		gap: 1rem;
	}

	@media (min-width: 40rem) {
		.gauges {
			grid-template-columns: 1fr 1fr;
		}
	}

	.gauge {
		display: grid;
		gap: 0.4375rem;
	}

	.gauge-head,
	.gauge-foot {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}

	.gauge-name {
		font-size: 0.875rem;
	}

	.gauge-value {
		font-family: var(--font-mono);
		font-size: 1.0625rem;
		font-weight: 600;
	}

	.gauge[data-ok='true'] .gauge-value {
		color: var(--color-ok);
	}
	.gauge[data-ok='false'] .gauge-value {
		color: var(--color-bad);
	}

	.track {
		height: 7px;
		background: var(--color-surface-sunken);
		border-radius: 999px;
		overflow: hidden;
	}

	.fill {
		height: 100%;
		border-radius: 999px;
		transition:
			width 200ms ease,
			background-color 200ms ease;
	}

	.gauge[data-ok='true'] .fill {
		background: var(--color-ok);
	}
	.gauge[data-ok='false'] .fill {
		background: var(--color-bad);
	}

	.gauge-foot {
		font-size: 0.75rem;
		color: oklch(0.66 0.01 260);
	}

	.gauge[data-ok='false'] .verdict {
		color: var(--color-bad);
	}

	.readout {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-radius: 9px;
	}

	.readout code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.7;
		color: oklch(0.8 0.01 260);
		word-break: break-word;
	}

	.readout code b {
		color: var(--color-accent);
	}

	.savings {
		margin: 0;
		font-size: 0.8125rem;
		color: oklch(0.68 0.01 260);
	}

	.status p {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
	}

	.status-ok {
		color: var(--color-ok);
	}
	.status-bad {
		color: var(--color-warn);
	}

	.disclaimer {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.7;
		color: oklch(0.6 0.01 260);
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 0.875rem;
	}
</style>
