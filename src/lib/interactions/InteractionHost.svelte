<script lang="ts">
	/**
	 * 声明式笔记交互的统一渲染器。
	 *
	 * 交互内容只提供参数、预设和纯 evaluate 函数；这里统一负责控件、指标、约束条、
	 * 排名、重置、键盘与 aria-live。新增一篇交互应主要写配置，而不是复制一套 UI。
	 */
	import { onMount } from 'svelte';
	import { interactionProgress } from '$lib/storage/interaction-progress.svelte';
	import type { InteractionSpec } from './types';

	interface Props {
		spec: InteractionSpec;
	}

	let { spec }: Props = $props();
	let values = $state<Record<string, number>>(defaults());

	onMount(() => interactionProgress.load());

	function defaults(): Record<string, number> {
		return Object.fromEntries(spec.parameters.map((p) => [p.id, p.defaultValue]));
	}

	const evaluation = $derived(spec.evaluate(values));
	const dirty = $derived(spec.parameters.some((p) => values[p.id] !== p.defaultValue));

	function setValue(id: string, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		values = { ...values, [id]: input.valueAsNumber };
		// input 事件由 NoteWidgets 外层统一记录，避免同一次拖动写两次 localStorage。
	}

	function applyPreset(preset: InteractionSpec['presets'][number]) {
		values = { ...values, ...preset.values };
		interactionProgress.record(spec.id, true);
	}

	function reset() {
		values = defaults();
	}

	function digitsFor(step: number): number {
		const text = String(step);
		return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
	}

	function format(value: number, digits?: number): string {
		return new Intl.NumberFormat('zh-CN', {
			maximumFractionDigits: digits ?? 2,
			minimumFractionDigits: digits ?? 0
		}).format(value);
	}
</script>

<section
	class="interaction"
	data-interaction-id={spec.id}
	aria-labelledby="interaction-title-{spec.id}"
>
	<header class="head">
		<div>
			<p class="eyebrow">可调实验 · {spec.type}</p>
			<h3 id="interaction-title-{spec.id}">{spec.title}</h3>
			<p class="description">{spec.description}</p>
		</div>
		<button class="reset" type="button" onclick={reset} disabled={!dirty}>重置</button>
	</header>

	{#if spec.presets.length > 0}
		<div class="presets" aria-label="实验预设">
			{#each spec.presets as preset (preset.id)}
				<button type="button" onclick={() => applyPreset(preset)}>{preset.label}</button>
			{/each}
		</div>
	{/if}

	<div class="parameters">
		{#each spec.parameters as parameter (parameter.id)}
			<label class="parameter">
				<span class="parameter-label">
					{parameter.label}
					<output for="param-{spec.id}-{parameter.id}">
						{format(
							values[parameter.id],
							parameter.digits ?? digitsFor(parameter.step)
						)}{parameter.unit ?? ''}
					</output>
				</span>
				<input
					id="param-{spec.id}-{parameter.id}"
					type="range"
					min={parameter.min}
					max={parameter.max}
					step={parameter.step}
					value={values[parameter.id]}
					oninput={(event) => setValue(parameter.id, event)}
					aria-label={parameter.label}
					aria-valuetext={`${format(values[parameter.id], parameter.digits ?? digitsFor(parameter.step))}${parameter.unit ?? ''}`}
				/>
			</label>
		{/each}
	</div>

	<div class="results">
		<div class="metrics">
			{#each evaluation.metrics as metric (metric.label)}
				<div class="metric" data-tone={metric.tone ?? 'neutral'}>
					<span class="metric-value">{format(metric.value, metric.digits)}{metric.unit ?? ''}</span>
					<span class="metric-label">{metric.label}</span>
				</div>
			{/each}
		</div>

		{#if evaluation.bars?.length}
			<div class="bars">
				{#each evaluation.bars as bar (bar.label)}
					<div class="bar-row">
						<div class="bar-head"><span>{bar.label}</span><span>{bar.valueLabel}</span></div>
						<div class="bar-track" role="img" aria-label={`${bar.label}：${bar.valueLabel}`}>
							<i
								data-tone={bar.tone ?? 'neutral'}
								style={`width:${Math.min(100, Math.max(0, (bar.value / bar.max) * 100))}%`}
							></i>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if evaluation.ranking?.length}
			<ol class="ranking">
				{#each evaluation.ranking as item, i (item.label)}
					<li>
						<span class="rank">{i + 1}</span>
						<span class="rank-main"><b>{item.label}</b><small>{item.reason}</small></span>
						<span class="score">{format(item.score, 1)}</span>
					</li>
				{/each}
			</ol>
		{/if}

		<p class="conclusion" data-tone={evaluation.tone} aria-live="polite">{evaluation.conclusion}</p>
	</div>
</section>

<style>
	.interaction {
		display: grid;
		gap: var(--space-5);
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.eyebrow {
		margin: 0 0 var(--space-1);
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--color-accent);
	}
	h3 {
		margin: 0;
		font-size: var(--fs-lg);
		color: var(--color-text-strong);
	}
	.description {
		margin: var(--space-1) 0 0;
		font-size: var(--fs-sm);
		line-height: 1.65;
		color: var(--color-text-muted);
	}
	.reset,
	.presets button {
		min-height: 40px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--color-accent);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.reset:disabled {
		background: var(--color-disabled-surface);
		color: var(--color-disabled-text);
		border-color: transparent;
		cursor: default;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.parameters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-4);
	}
	.parameter {
		display: grid;
		gap: var(--space-2);
	}
	.parameter-label,
	.bar-head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--fs-sm);
		color: var(--color-text-soft);
	}
	output,
	.bar-head span:last-child,
	.score {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--color-text-strong);
	}
	input[type='range'] {
		width: 100%;
		min-height: 44px;
		accent-color: var(--color-accent);
	}
	.results {
		display: grid;
		gap: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border-subtle);
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: var(--space-3);
	}
	.metric {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3);
		background: var(--color-surface-sunken);
		border-radius: var(--radius-control);
	}
	.metric-value {
		font-family: var(--font-mono);
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--color-text-strong);
	}
	.metric[data-tone='ok'] .metric-value {
		color: var(--color-ok);
	}
	.metric[data-tone='warn'] .metric-value {
		color: var(--color-warn);
	}
	.metric[data-tone='bad'] .metric-value {
		color: var(--color-bad);
	}
	.metric-label {
		font-size: var(--fs-xs);
		color: var(--color-text-muted);
	}
	.bars {
		display: grid;
		gap: var(--space-3);
	}
	.bar-row {
		display: grid;
		gap: var(--space-1);
	}
	.bar-track {
		height: 8px;
		background: var(--color-track);
		border-radius: 999px;
		overflow: hidden;
	}
	.bar-track i {
		display: block;
		height: 100%;
		background: var(--color-accent);
		transition: width var(--dur-ui) var(--ease-out);
	}
	.bar-track i[data-tone='ok'] {
		background: var(--color-ok);
	}
	.bar-track i[data-tone='warn'] {
		background: var(--color-warn);
	}
	.bar-track i[data-tone='bad'] {
		background: var(--color-bad);
	}
	.ranking {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-2);
	}
	.ranking li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--space-3);
		align-items: center;
		padding: var(--space-3);
		background: var(--color-surface-sunken);
		border-radius: var(--radius-control);
	}
	.rank {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.rank-main {
		display: grid;
		gap: var(--space-1);
	}
	.rank-main b {
		color: var(--color-text-strong);
	}
	.rank-main small {
		color: var(--color-text-muted);
		font-size: var(--fs-xs);
	}
	.conclusion {
		margin: 0;
		padding: var(--space-3);
		border-left: 3px solid var(--color-accent);
		background: var(--color-surface-sunken);
		border-radius: 0 var(--radius-control) var(--radius-control) 0;
		line-height: 1.65;
		color: var(--color-text);
	}
	.conclusion[data-tone='ok'] {
		border-left-color: var(--color-ok);
	}
	.conclusion[data-tone='warn'] {
		border-left-color: var(--color-warn);
	}
	.conclusion[data-tone='bad'] {
		border-left-color: var(--color-bad);
	}
</style>
