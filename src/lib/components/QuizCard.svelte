<script lang="ts">
	/**
	 * 答题卡。
	 *
	 * 三条设计原则：
	 * 1. 反馈必须快于 300ms —— 慢了就失去「击中感」
	 * 2. 答错不是终点：第一次错给提示并允许重答，第二次错才展开完整推导。
	 *    错误是内容的入口，不是惩罚。
	 * 3. 无障碍优先：选择题用真 radio，判定结果用 aria-live 播报，
	 *    容器用 form 使 Enter 键天然可用
	 *
	 * 使用契约：组件不监听 question 变化做自我重置。
	 * 换题时调用方必须用 {#key question.id} 包裹，让组件整体重建。
	 * 这比在组件内做 $effect 重置更不容易出状态残留。
	 */
	import { renderInline, renderProse } from '$lib/quiz/inline-markdown';
	import { judge } from '$lib/quiz/judge';
	import type { JudgeResult, SyncQuestion } from '$lib/quiz/types';

	interface Props {
		/**
		 * 只接受能同步判定的题型。代码题走 CodeQuestionCard——
		 * 用类型而不是运行时检查来保证分派正确。
		 */
		question: SyncQuestion;
		/** 判定完成时回调，用于上报进度。仅在本题最终定论时触发一次 */
		onResolved?: (correct: boolean) => void;
		/** 点击「下一题」时回调 */
		onNext?: () => void;
		/** 是否显示「下一题」按钮 */
		showNext?: boolean;
	}

	let { question, onResolved, onNext, showNext = true }: Props = $props();

	let input = $state('');
	let selected = $state<number | null>(null);
	let result = $state<JudgeResult | null>(null);
	let wrongAttempts = $state(0);
	/** 本题是否已定论（答对，或答错两次） */
	let settled = $state(false);

	const canSubmit = $derived(question.kind === 'numeric' ? input.trim() !== '' : selected !== null);

	/** 第一次答错时给提示并允许重答；第二次答错则公布答案 */
	const showHint = $derived(wrongAttempts === 1 && !settled && !!question.hint);
	const showExplanation = $derived(settled);

	/** 答错时针对所选干扰项的定向说明，比通用解释更有针对性 */
	const distractorNote = $derived.by(() => {
		if (question.kind !== 'choice' || !result || result.correct) return null;
		if (typeof result.parsed !== 'number') return null;
		return question.distractorNotes?.[result.parsed] ?? null;
	});

	function submit() {
		if (settled || !canSubmit) return;

		const answer = question.kind === 'numeric' ? input : selected;
		const r = judge(question, answer);
		result = r;

		if (r.correct) {
			settled = true;
			onResolved?.(true);
			return;
		}

		wrongAttempts += 1;
		// 第二次答错公布答案；未作答不计入错误次数
		if (r.verdict !== 'empty' && wrongAttempts >= 2) {
			settled = true;
			onResolved?.(false);
		}
	}

	/**
	 * 改动答案时清掉上一次的错误判定。
	 *
	 * 改版前答错后必须先点「再试一次」才能重提：直接改数字再回车，
	 * handleSubmit 会走到 retry() 把刚输入的答案清空。零上下文复查者
	 * 「愣了一下才找到再试一次」。现在改答案就等于重新开始这一次作答，
	 * 「再试一次」保留给不想改答案、只想清空重来的人。
	 */
	function clearWrongResult() {
		if (settled) return;
		if (result && !result.correct) result = null;
	}

	function retry() {
		result = null;
		if (question.kind === 'numeric') input = '';
		else selected = null;
	}

	/**
	 * 表单提交的统一分派。
	 * 用 form 而非在容器上挂 keydown，这样 Enter 键天然可用，
	 * 也不会产生「非交互元素挂键盘事件」的无障碍问题。
	 */
	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (settled) onNext?.();
		else if (result && !result.correct && result.verdict !== 'empty') retry();
		else submit();
	}

	/** 边框状态：判定结果驱动 */
	const frameState = $derived(
		result === null ? 'idle' : result.correct ? 'ok' : result.verdict === 'empty' ? 'idle' : 'bad'
	);
</script>

<form
	class="card"
	data-state={frameState}
	aria-labelledby="q-{question.id}"
	onsubmit={handleSubmit}
	novalidate
>
	<p class="prompt" id="q-{question.id}">{question.prompt}</p>

	{#if question.kind === 'numeric'}
		<div class="answer-row">
			<label class="sr-only" for="input-{question.id}">你的答案</label>
			<input
				id="input-{question.id}"
				class="numeric-input"
				type="text"
				inputmode="decimal"
				autocomplete="off"
				placeholder="输入数值"
				bind:value={input}
				oninput={clearWrongResult}
				disabled={settled}
				aria-describedby="feedback-{question.id}"
			/>
			{#if question.unit}
				<span class="unit" aria-hidden="true">{question.unit}</span>
			{/if}
		</div>
	{:else}
		<fieldset class="options" disabled={settled}>
			<legend class="sr-only">选择一个答案</legend>
			{#each question.options as option, i (i)}
				<label
					class="option"
					onchange={clearWrongResult}
					data-correct={settled && i === question.answerIndex}
					data-chosen={settled && selected === i && i !== question.answerIndex}
				>
					<input type="radio" name="opt-{question.id}" value={i} bind:group={selected} />
					<span class="marker" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
					<span class="option-text">{option}</span>
				</label>
			{/each}
		</fieldset>
	{/if}

	<!-- 判定反馈：aria-live 确保屏幕阅读器能感知 -->
	<div class="feedback" id="feedback-{question.id}" aria-live="polite">
		{#if result?.verdict === 'unparseable'}
			<p class="msg msg-warn">这不像一个数字。直接填数值即可，单位可以省略。</p>
		{:else if result && !result.correct && result.verdict !== 'empty'}
			<p class="msg msg-bad">
				不对
				{#if question.kind === 'numeric' && result.parsed !== undefined}
					<span class="detail">你填的是 {result.parsed}</span>
				{/if}
			</p>
		{:else if result?.correct}
			<p class="msg msg-ok">
				{result.verdict === 'within-tolerance' ? '对了（在容差范围内）' : '答对了'}
			</p>
		{/if}

		{#if showHint}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderInline 已转义 -->
			<p class="hint">💡 {@html renderInline(question.hint ?? '')}</p>
		{/if}

		{#if distractorNote}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderInline 已转义 -->
			<p class="distractor">{@html renderInline(distractorNote)}</p>
		{/if}

		{#if showExplanation}
			<div class="explanation">
				{#if question.kind === 'numeric' && result && !result.correct}
					<p class="correct-answer">
						正确答案：<b>{question.answer}{question.unit ?? ''}</b>
					</p>
				{/if}
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

	<div class="actions">
		{#if settled}
			{#if showNext}
				<button class="btn btn-primary" type="submit">下一题 →</button>
			{/if}
		{:else if result && !result.correct && result.verdict !== 'empty'}
			<button class="btn btn-primary" type="submit">再试一次</button>
		{:else}
			<button class="btn btn-primary" type="submit" disabled={!canSubmit}>提交</button>
			{#if !canSubmit}
				<!-- 按钮置灰但不说原因时，用户会以为按钮坏了 -->
				<span class="submit-why">
					{question.kind === 'numeric' ? '先填一个数值' : '先选一项'}
				</span>
			{/if}
		{/if}
	</div>
</form>

<style>
	.card {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		padding: 1.75rem;
		display: grid;
		gap: 1.25rem;
		/* 反馈动画控制在 180ms，快于 300ms 的感知阈值 */
		transition:
			border-color 180ms ease,
			box-shadow 180ms ease;
	}

	.card[data-state='ok'] {
		border-color: var(--color-ok);
		box-shadow: 0 0 0 1px var(--color-ok);
		animation: pulse-ok 320ms ease;
	}

	.card[data-state='bad'] {
		border-color: var(--color-bad);
		box-shadow: 0 0 0 1px var(--color-bad);
		animation: shake 220ms ease;
	}

	@keyframes pulse-ok {
		50% {
			transform: scale(1.008);
		}
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-5px);
		}
		75% {
			transform: translateX(5px);
		}
	}

	.prompt {
		margin: 0;
		font-size: 1.0625rem;
		line-height: 1.7;
		/* 题干里的换行是有意义的（分行给参数），必须保留 */
		white-space: pre-wrap;
	}

	.answer-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.numeric-input {
		flex: 0 1 12rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 8px;
		padding: 0.625rem 0.875rem;
		color: inherit;
		font-family: var(--font-mono);
		font-size: 1.0625rem;
	}

	.numeric-input:disabled {
		opacity: 0.65;
	}

	.unit {
		color: oklch(0.68 0.01 260);
		font-size: 0.9375rem;
	}

	.options {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		cursor: pointer;
		transition: border-color 140ms ease;
		line-height: 1.6;
	}

	.options:not([disabled]) .option:hover {
		border-color: var(--color-accent-dim);
	}

	/* 隐藏原生 radio 但保留键盘与读屏可达性 */
	.option input[type='radio'] {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.option:has(input:checked) {
		border-color: var(--color-accent);
	}

	.option:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.option[data-correct='true'] {
		border-color: var(--color-ok);
		background: color-mix(in oklch, var(--color-ok) 12%, var(--color-surface-sunken));
	}

	.option[data-chosen='true'] {
		border-color: var(--color-bad);
		background: color-mix(in oklch, var(--color-bad) 12%, var(--color-surface-sunken));
	}

	.marker {
		flex: 0 0 auto;
		width: 1.5rem;
		height: 1.5rem;
		display: grid;
		place-items: center;
		border-radius: 5px;
		background: var(--color-surface);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	.feedback:empty {
		display: none;
	}

	.feedback {
		display: grid;
		gap: 0.75rem;
	}

	.msg {
		margin: 0;
		font-weight: 600;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.msg-ok {
		color: var(--color-ok);
	}
	.msg-bad {
		color: var(--color-bad);
	}
	.msg-warn {
		color: var(--color-warn);
		font-weight: 500;
	}

	.detail {
		font-weight: 400;
		font-size: 0.875rem;
		color: oklch(0.68 0.01 260);
		font-family: var(--font-mono);
	}

	.hint,
	.distractor {
		margin: 0;
		padding: 0.75rem 0.875rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		line-height: 1.7;
	}

	.hint {
		background: color-mix(in oklch, var(--color-warn) 10%, var(--color-surface-sunken));
		border-left: 2px solid var(--color-warn);
	}

	.distractor {
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-bad);
		color: oklch(0.82 0.01 260);
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
		color: oklch(0.95 0.005 260);
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

	.explanation :global(p) {
		margin: 0;
		white-space: pre-wrap;
	}

	.correct-answer {
		color: var(--color-ok);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn {
		font: inherit;
		padding: 0.5625rem 1.125rem;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: opacity 140ms ease;
	}

	.submit-why {
		font-size: 0.8125rem;
		color: oklch(0.62 0.01 260);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-primary {
		background: var(--color-accent);
		color: oklch(0.15 0.02 200);
		font-weight: 600;
	}

	.btn-primary:not(:disabled):hover {
		opacity: 0.88;
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
		border: 0;
	}
</style>
