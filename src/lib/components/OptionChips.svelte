<script lang="ts">
	/**
	 * 一组互斥选项（单选 chip 组）。
	 *
	 * 三个达标型沙盒各有两组，六份标记和 CSS 完全一致。
	 *
	 * 用原生 `<input type="radio">` 而不是按钮 + aria：radio 组自带键盘方向键切换、
	 * 自带 `:checked` 状态和分组语义，换成按钮要手写一遍无障碍行为还容易漏。
	 * 输入框视觉上隐藏但仍可聚焦，焦点环通过 `:has(input:focus-visible)` 画在 chip 上。
	 */

	export interface ChipOption {
		id: string;
		label: string;
		/** 第二行小字，如「8 组」「2 byte/元素」。没有就不渲染 */
		detail?: string;
	}

	interface Props {
		/** 分组标题 */
		legend: string;
		/** radio 的 name，同一页里必须唯一，否则两组会互相抢选中态 */
		name: string;
		options: readonly ChipOption[];
		/** 当前选中的选项 id */
		value: string;
	}

	let { legend, name, options, value = $bindable() }: Props = $props();
</script>

<fieldset>
	<legend>{legend}</legend>
	<div class="chips">
		{#each options as opt (opt.id)}
			<label class="chip">
				<input type="radio" {name} value={opt.id} bind:group={value} />
				<span class="chip-label">{opt.label}</span>
				{#if opt.detail}
					<span class="chip-detail">{opt.detail}</span>
				{/if}
			</label>
		{/each}
	</div>
</fieldset>

<style>
	/* 以下规则从三个沙盒里原样搬来，此前逐字重复了三遍 */
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}

	legend {
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
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
		color: var(--color-text-muted);
	}
</style>
