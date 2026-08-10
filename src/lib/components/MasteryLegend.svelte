<script lang="ts">
	/**
	 * 掌握度四档的解释。
	 *
	 * 零上下文复查里「我完全没看懂的东西」第一条就是这四个词：
	 * 已掌握 / 在学 / 需重练 / 未做 分散出现在首页统计栏、首页模块行、
	 * 关卡自测栏三个位置，**全站零解释**。复查者是做实验才推断出
	 * 「在学 = 答对过但没到掌握」「需重练 = 答错过」，而「已掌握」
	 * 至今没见它变过——因为要连续答对到最高盒才算。
	 *
	 * 做成 <details> 而不是 tooltip：键盘和屏幕阅读器天然可用，
	 * 收起时只占一行，不给已经懂的人添噪声。
	 */
	import { INTERVALS_DAYS, MAX_BOX } from '$lib/quiz/schedule';

	interface Props {
		/** 紧凑模式：字号更小，用在关卡页的统计栏旁边 */
		compact?: boolean;
	}

	let { compact = false }: Props = $props();

	/** 1、3、7、16、35 —— 从调度表里取，不手写，避免和实现漂移 */
	const intervals = INTERVALS_DAYS.slice(1).join('、');
</script>

<details class="legend" class:compact data-testid="mastery-legend">
	<summary>这四个状态是什么意思？</summary>
	<dl>
		<div>
			<dt class="ok">已掌握</dt>
			<dd>
				连续答对到最高一档（共 {MAX_BOX} 档）。之后间隔 {INTERVALS_DAYS[MAX_BOX]} 天才会再问你一次。
			</dd>
		</div>
		<div>
			<dt class="warn">在学</dt>
			<dd>答对过，但还没升到最高档。每答对一次间隔就拉长：{intervals} 天。</dd>
		</div>
		<div>
			<dt class="bad">需重练</dt>
			<dd>
				答错过。答错会把档位直接归零而不是退一档——检索失败说明得从头巩固，所以它会立刻回到队列。
			</dd>
		</div>
		<div>
			<dt>未做</dt>
			<dd>还没答过。新题优先排在到期的旧题之前。</dd>
		</div>
	</dl>
	<p class="note">
		答对的题不会立刻再出现，这是刻意的：隔几天再检索才能区分「真记住了」和「刚看过」。
		所以做完一轮后题目区会显示空——那是调度在生效，不是进度丢了。
	</p>
</details>

<style>
	.legend {
		font-size: 0.8125rem;
		color: oklch(0.72 0.01 260);
	}

	.legend.compact {
		font-size: 0.75rem;
	}

	summary {
		cursor: pointer;
		color: var(--color-accent);
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}

	dl {
		margin: 0.5rem 0 0;
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-radius: 9px;
	}

	dt {
		font-weight: 600;
		font-size: 0.8125rem;
	}

	dt.ok {
		color: var(--color-ok);
	}

	dt.warn {
		color: var(--color-warn);
	}

	dt.bad {
		color: var(--color-bad);
	}

	dd {
		margin: 0.125rem 0 0;
		line-height: 1.7;
		color: oklch(0.74 0.01 260);
	}

	.note {
		margin: 0.5rem 0 0;
		padding: 0 1rem;
		line-height: 1.7;
		color: oklch(0.66 0.01 260);
	}
</style>
