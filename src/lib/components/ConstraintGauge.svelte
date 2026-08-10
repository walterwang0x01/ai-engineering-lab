<script lang="ts">
	/**
	 * 单个约束仪表：指标值 + 进度条 + 预算 + 判定文案。
	 *
	 * 从三个达标型沙盒里抽出来的——它们的这段标记和 CSS 逐条比对后完全相同，
	 * 只有名称、格式化和文案不同。
	 *
	 * **标记和 class 必须与抽取前逐字一致**：KvCacheSandbox.svelte.spec.ts 和
	 * e2e/smoke.mjs 都按 data-testid 与 `.gauge[data-ok]` 断言，
	 * 这个组件的等价性正是靠那批断言不改一字仍然通过来证明的。
	 */
	import { barPct } from '$lib/sandbox/constraints';

	interface Props {
		/** 指标名，如「KV Cache 显存」 */
		name: string;
		/** 已格式化的指标值，含单位。格式化留在调用方，各沙盒的精度习惯不同 */
		value: string;
		/** 数值断言用的 testid。同一页里数值常重复出现，必须靠 testid 定位 */
		testId: string;
		/** 是否满足约束 */
		ok: boolean;
		/** 进度条的当前值 */
		current: number;
		/** 进度条的分母。注意「下限型」约束（召回率 ≥ x）传 1 而不是阈值 */
		scale: number;
		/** 预算说明，如「预算 45 GB」「下限 90%」 */
		budgetLabel: string;
		/** 判定文案，如「在预算内」「超出 275 GB」 */
		verdict: string;
	}

	let { name, value, testId, ok, current, scale, budgetLabel, verdict }: Props = $props();
</script>

<div class="gauge" data-ok={ok}>
	<div class="gauge-head">
		<span class="gauge-name">{name}</span>
		<span class="gauge-value" data-testid={testId}>{value}</span>
	</div>
	<div class="track">
		<div class="fill" style="width: {barPct(current, scale)}%"></div>
	</div>
	<div class="gauge-foot">
		<span>{budgetLabel}</span>
		<span class="verdict">{verdict}</span>
	</div>
</div>

<style>
	/* 以下规则从三个沙盒里原样搬来，它们此前逐字重复了三遍 */
	.gauge {
		display: grid;
		gap: 0.4375rem;
	}

	.gauge-head {
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
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.gauge[data-ok='false'] .verdict {
		color: var(--color-bad);
	}
</style>
