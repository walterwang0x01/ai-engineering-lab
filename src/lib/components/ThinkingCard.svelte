<script lang="ts">
	/**
	 * 思考卡：先猜后看，不判对错。
	 *
	 * ## 它和 QuizCard 的区别不是「少了个判定」，是身份不同
	 *
	 * QuizCard 消费的是**已过审**的题：判定对错、写进学习记录、进间隔重复排期。
	 * 这张卡消费的是**还没过审**的草稿题——人还没逐题核实过。
	 *
	 * 所以这里刻意不做三件事：
	 *   1. **不判对错。** 不给「答对 / 答错」的结论，因为那等于声称
	 *      「本题答案经过核实」，而它恰恰没有。
	 *   2. **不写学习记录。** 不进掌握度、不进排期、不产生任何可积累的状态。
	 *   3. **明确标注未过审。** 读者知道自己在看草稿，能自己决定信几分。
	 *
	 * 剩下的才是它要做的事：把已经写好的解析摆出来，让人边读边想。
	 * 草稿里那 418 道带逐项解析的题，藏起来的代价是绝大多数笔记
	 * 一个可动手的东西都没有——那才是真的「枯燥」。
	 *
	 * ## 揭示之后还能继续点
	 *
	 * 揭示答案后点别的选项不会重置，而是换成「这一项为什么不对」。
	 * 干扰项解析（`distractorNotes`）本来就是逐项写的，
	 * 一次只给人看一条太浪费；让人把四个选项都点一遍，
	 * 比只公布正确答案学到的多。
	 *
	 * ## 使用契约
	 *
	 * 和 QuizCard 一样不自我重置，换题靠调用方用 {#key question.id} 包裹。
	 */
	import { renderInline, renderProse } from '$lib/quiz/inline-markdown';
	import type { ChoiceQuestion } from '$lib/quiz/types';

	interface Props {
		/** 只接受选择题——本项目的草稿题全是选择题 */
		question: ChoiceQuestion;
		/** 点击「下一题」时回调 */
		onNext?: () => void;
		/** 是否显示「下一题」按钮 */
		showNext?: boolean;
		/** 首次揭示时回调。只用来记「这篇我动过手了」，不记对错 */
		onReveal?: () => void;
	}

	let { question, onNext, showNext = true, onReveal }: Props = $props();

	let selected = $state<number | null>(null);
	let revealed = $state(false);
	let hintOpen = $state(false);

	/**
	 * 当前所选选项的定向解析。
	 *
	 * 选了正确项时没有专门的 note——`distractorNotes` 按定义只覆盖错误项，
	 * 正确答案的完整推导在 `explanation` 里，下面另外渲染。
	 */
	const chosenNote = $derived(
		selected !== null && selected !== question.answerIndex
			? (question.distractorNotes?.[selected] ?? null)
			: null
	);

	const choseWrong = $derived(selected !== null && selected !== question.answerIndex);

	function choose(index: number) {
		const first = !revealed;
		selected = index;
		revealed = true;
		if (first) onReveal?.();
	}

	function rethink() {
		selected = null;
		revealed = false;
		hintOpen = false;
	}
</script>

<div class="card" data-revealed={revealed} aria-labelledby="think-{question.id}">
	<!--
		这行不是免责声明的废话，是这张卡的身份。
		没有它，界面上剩下的所有元素都和 QuizCard 长得一样，
		读者无从知道自己看到的内容没经过人工核实。
	-->
	<p class="draft-note" data-testid="thinking-draft-note">
		<span class="draft-dot" aria-hidden="true"></span>
		草稿 · 未经人工核实，解析仅供参考
	</p>

	<p class="prompt" id="think-{question.id}">{question.prompt}</p>

	<fieldset class="options">
		<legend class="sr-only">先选一个，再看解析</legend>
		{#each question.options as option, i (i)}
			<label
				class="option"
				data-correct={revealed && i === question.answerIndex}
				data-chosen={revealed && selected === i && i !== question.answerIndex}
			>
				<input
					type="radio"
					name="think-{question.id}"
					value={i}
					checked={selected === i}
					onchange={() => choose(i)}
				/>
				<span class="marker" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
				<span class="option-text">{option}</span>
			</label>
		{/each}
	</fieldset>

	<div class="feedback" aria-live="polite">
		{#if hintOpen && question.hint}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderInline 已转义 -->
			<p class="hint">💡 {@html renderInline(question.hint)}</p>
		{/if}

		{#if revealed}
			<p class="msg" data-match={!choseWrong} data-testid="thinking-verdict">
				{#if choseWrong}
					你选的不是这一篇给的答案
				{:else}
					和这篇给的答案一致
				{/if}
			</p>

			{#if chosenNote}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderInline 已转义 -->
				<p class="distractor">{@html renderInline(chosenNote)}</p>
			{/if}

			<div class="explanation">
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

			{#if chosenNote}
				<p class="prowl">点其他选项，看看各自为什么不成立。</p>
			{/if}
		{/if}
	</div>

	<div class="actions">
		{#if !revealed}
			{#if question.hint}
				<button class="btn btn-ghost" type="button" onclick={() => (hintOpen = !hintOpen)}>
					{hintOpen ? '收起提示' : '给点提示'}
				</button>
			{/if}
			<span class="submit-why">选一项就出解析，不计分</span>
		{:else}
			<button class="btn btn-ghost" type="button" onclick={rethink}>再想想</button>
			{#if showNext}
				<button class="btn btn-primary" type="button" onclick={onNext}>下一题 →</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.card {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		padding: var(--space-6);
		display: grid;
		gap: var(--space-5);
		box-shadow: var(--shadow-card);
	}

	/*
	 * 草稿标记用 warn 的浅底，但文字保持正文色。
	 *
	 * 不用整卡染黄：那是「这条内容有问题」的视觉语言，
	 * 而草稿只是「还没核实」——它仍然是这篇笔记里可用的学习材料。
	 */
	.draft-note {
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
		background: var(--color-surface-sunken);
		border-radius: var(--radius-control);
		padding: var(--space-2) var(--space-3);
		width: fit-content;
	}

	.draft-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--color-warn);
		flex: 0 0 auto;
	}

	.prompt {
		margin: 0;
		font-size: var(--fs-md);
		line-height: 1.8;
		color: var(--color-text-strong);
		white-space: pre-wrap;
	}

	.options {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}

	.option {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		min-height: 44px;
		padding: var(--space-3);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		cursor: pointer;
		/* 与 QuizCard 同款：只过渡颜色，位移保持瞬时（元素在动会让
		   Playwright 的稳定性检查永远不通过，也是真实的误点来源） */
		transition:
			border-color var(--dur-verdict) var(--ease-out),
			background-color var(--dur-verdict) var(--ease-out);
		line-height: 1.6;
	}

	.option:hover {
		border-color: var(--color-accent-dim);
		transform: translateY(-1px);
	}

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
		border-color: var(--color-warn);
		background: color-mix(in oklch, var(--color-warn) 12%, var(--color-surface-sunken));
	}

	.marker {
		flex: 0 0 auto;
		width: 1.5rem;
		height: 1.5rem;
		display: grid;
		place-items: center;
		border-radius: var(--radius-control);
		background: var(--color-surface);
		color: var(--color-text-strong);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		font-weight: 600;
		transition:
			background-color var(--dur-verdict) var(--ease-out),
			color var(--dur-verdict) var(--ease-out);
	}

	.option[data-correct='true'] .marker {
		background: var(--color-ok);
		color: var(--color-on-accent);
	}

	.option[data-chosen='true'] .marker {
		background: var(--color-warn);
		color: var(--color-on-accent);
	}

	.feedback:empty {
		display: none;
	}

	.feedback {
		display: grid;
		gap: var(--space-3);
	}

	.msg {
		margin: 0;
		font-size: var(--fs-md);
		font-weight: 600;
	}

	/*
	 * 措辞上刻意避开「对 / 错」。
	 *
	 * 这张卡不产出结论，所以选中项与答案不一致时说的是
	 * 「你选的不是这一篇给的答案」——它描述的是两者之间的关系，
	 * 不是对读者判断的判决。连颜色都换成 warn（提醒）而不是 bad（错误）。
	 */
	.msg[data-match='true'] {
		color: var(--color-ok);
	}

	.msg[data-match='false'] {
		color: var(--color-warn);
	}

	.hint,
	.distractor {
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		font-size: var(--fs-base);
		line-height: 1.7;
	}

	.hint {
		background: color-mix(in oklch, var(--color-warn) 10%, var(--color-surface-sunken));
		border-left: 2px solid var(--color-warn);
	}

	.distractor {
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-warn);
		color: var(--color-text);
	}

	.prowl {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
	}

	.explanation {
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-accent);
		border-radius: var(--radius-control);
		padding: var(--space-4);
		display: grid;
		gap: var(--space-3);
		font-size: var(--fs-base);
		line-height: 1.75;
	}

	.explanation :global(p) {
		margin: 0;
		white-space: pre-wrap;
	}

	.explanation :global(code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
		padding: 0.0625rem var(--space-1);
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
	}

	.explanation :global(strong) {
		color: var(--color-text-strong);
	}

	.prose-code {
		margin: var(--space-3) 0;
		padding: var(--space-3);
		background: var(--color-surface-sunken);
		border-radius: var(--radius-control);
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		line-height: 1.6;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.btn {
		font: inherit;
		font-size: var(--fs-base);
		min-height: 44px;
		padding: 0 var(--space-5);
		border-radius: var(--radius-control);
		border: 1px solid transparent;
		cursor: pointer;
		transition: box-shadow var(--dur-ui) var(--ease-out);
	}

	.btn-primary {
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-weight: 600;
	}

	.btn-primary:hover {
		box-shadow: var(--shadow-lift);
	}

	.btn-ghost {
		background: transparent;
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}

	.btn-ghost:hover {
		border-color: var(--color-accent);
	}

	.submit-why {
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
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
