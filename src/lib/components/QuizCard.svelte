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
		border-radius: var(--radius-card);
		/* 内边距放宽、行距加大：这是「减少文字压迫感」最有效的一处，比任何动效都管用 */
		padding: var(--space-6);
		display: grid;
		gap: var(--space-5);
		box-shadow: var(--shadow-card);
		/* 判定反馈走 --dur-verdict（180ms），快于 300ms 的感知阈值 */
		transition:
			border-color var(--dur-verdict) var(--ease-out),
			box-shadow var(--dur-verdict) var(--ease-out);
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
		font-size: var(--fs-md);
		line-height: 1.8;
		/* 题干是这张卡里最该先读到的东西，给最重的墨色 */
		color: var(--color-text-strong);
		/* 题干里的换行是有意义的（分行给参数），必须保留 */
		white-space: pre-wrap;
	}

	.answer-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.numeric-input {
		flex: 0 1 12rem;
		/* 44px 触摸目标。原来靠 padding 撑出约 41px，差一点点但确实不达标 */
		min-height: 44px;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-control);
		padding: 0 var(--space-3);
		color: inherit;
		font-family: var(--font-mono);
		font-size: var(--fs-md);
		transition: border-color var(--dur-verdict) var(--ease-out);
	}

	.numeric-input:focus-visible {
		border-color: var(--color-accent);
	}

	/*
	 * 禁用态用显式取值，**不要用 opacity**。
	 *
	 * 原来这里是 `opacity: 0.65` —— 而同一个文件里 `.btn:disabled` 的注释
	 * 正写着「显式取值而不是 opacity，理由见 layout.css」。两处对同一个问题
	 * 给了相反的做法，说明那条约束当时只落实了一半。
	 *
	 * opacity 把元素往背景色拉：深色底往黑拉（浅字与深底的差值还在），
	 * 浅色底往白拉（本就浅的文字和浅底一起变淡，差值被压掉）。
	 * 答完题后输入框里留着的是**用户自己填的答案**，他要能回看自己填了什么，
	 * 所以这里照小字 4.5:1 要求，用 disabled-surface / disabled-text 那一对。
	 */
	.numeric-input:disabled {
		background: var(--color-disabled-surface);
		color: var(--color-disabled-text);
		border-color: var(--color-border-subtle);
		cursor: not-allowed;
	}

	.unit {
		color: var(--color-text-muted);
		font-size: var(--fs-base);
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
		/* 选项整行可点，min-height 保证窄屏上单行选项也够 44px */
		min-height: 44px;
		padding: var(--space-3);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-control);
		cursor: pointer;
		/*
		 * 刻意**不过渡 transform**（见下面 hover 规则的说明）。
		 * 只过渡颜色，判定时的高亮变化才有动感，而位移保持瞬时。
		 */
		transition:
			border-color var(--dur-verdict) var(--ease-out),
			background-color var(--dur-verdict) var(--ease-out);
		line-height: 1.6;
	}

	/*
	 * hover 的 1px 位移是**瞬时**的，不进过渡列表。
	 *
	 * 第一版我把 transform 加进了上面的 transition，于是这个位移变成 180ms
	 * 的动画 —— 而选项是点击目标。Playwright 点击前先 hover，且拒绝点击
	 * 边界框还在变化的元素；动画期间它每帧都在变。主按钮那边正是这么超时的，
	 * 只不过选项这边更可能表现为**偶发**失败，比稳定失败更难查。
	 *
	 * 保持瞬时：元素跳一次就稳定，稳定性检查立刻通过，而人眼看到的
	 * 「按下去有反应」效果没有区别。
	 */
	.options:not([disabled]) .option:hover {
		border-color: var(--color-accent-dim);
		transform: translateY(-1px);
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

	/*
	 * 判定后给标记本身上色。
	 *
	 * `.marker` 一直声明着 background-color 与 color 的过渡，但**没有任何规则
	 * 改变过这两个属性** —— 那两行过渡是死代码，A/B/C/D 标记从判定前到判定后
	 * 一直是同一个灰底。过渡声明本身说明当初有这个意图，只是没落地。
	 *
	 * 落地它的价值不只是好看：答错时屏幕上同时有「正确项」和「你选的项」两个
	 * 高亮行，而 12% 的底色差在小屏上很弱，标记染色让两行的角色一眼可分。
	 *
	 * 前景用 `--color-on-accent`：那一档正是为「压在饱和填充上的文字」设的。
	 *
	 * 但它此前只被校验过压在 **accent** 上（palette.spec.ts 里
	 * 「强调色填充上的文字」那条，为主按钮设的），压在 ok / bad 上没人盯 ——
	 * 而这正是本系列反复在修的那类问题：门禁保证的是 token 取值，
	 * 管不到有人把它用在未被校验的新组合里。所以这次不是靠「看着应该没问题」
	 * 就用下去，而是给这两对新组合补了门禁（见 palette.spec.ts 同一个 describe）。
	 * 实测浅色 4.96:1 / 5.86:1，深色 8.45:1 / 5.76:1，两套都过 AA。
	 */
	.option[data-correct='true'] .marker {
		background: var(--color-ok);
		color: var(--color-on-accent);
	}

	.option[data-chosen='true'] .marker {
		background: var(--color-bad);
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
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
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
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
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
		border-left: 2px solid var(--color-bad);
		color: var(--color-text);
	}

	/* explanation 里的参考解法代码块。不做语法高亮：关卡页不加载 highlight.js */
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

	.explanation :global(code) {
		font-family: var(--font-mono);
		/* 用 em 而不是 token：行内代码要跟着所在文字的字号缩放 */
		font-size: 0.875em;
		padding: 0.0625rem var(--space-1);
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
	}

	.explanation :global(strong) {
		color: var(--color-text-strong);
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

	.correct-answer {
		color: var(--color-ok);
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
		/* 提交按钮是这张卡上最常被点的东西，原来靠 padding 撑出约 38px */
		min-height: 44px;
		padding: 0 var(--space-5);
		border-radius: var(--radius-control);
		border: 1px solid transparent;
		cursor: pointer;
		/*
		 * 只过渡 box-shadow，**不要过渡 transform**，也不要在 hover 里位移。
		 *
		 * 第一版跟着全站卡片的 hover 语言给这个按钮加了 `translateY(-1px)`，
		 * QuizCard 的测试立刻超时，报的是 `element is not stable`：
		 * Playwright 点击前会先 hover，而它拒绝点击边界框还在变化的元素。
		 *
		 * 这不是测试太严格，位移本身对按钮就是坏主意：指针停在按钮下边缘时，
		 * 元素上移会让指针脱离它 → hover 撤销 → 元素落回 → 再次进入 hover，
		 * 形成抖动循环。卡片能这么做是因为面积大、1px 相对无害；
		 * 44px 高的按钮不行。移除位移后本文件 23 个测试全过。
		 *
		 * 阴影不参与布局，能表达同样的「浮起」而完全不动几何。
		 */
		transition: box-shadow var(--dur-ui) var(--ease-out);
	}

	.submit-why {
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
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
		color: var(--color-on-accent);
		font-weight: 600;
	}

	/*
	 * hover 用阴影，**不用 opacity**。
	 *
	 * 原来是 `opacity: 0.88`，和上面 `.numeric-input:disabled` 曾经的
	 * `opacity: 0.65` 是同一个反模式：opacity 作用在整个元素上，
	 * accent 底和压在它上面的 on-accent 前景**一起**往背景色拉 ——
	 * 而 palette.spec.ts 专门校验的就是这两者之间的 4.5:1。
	 * 门禁保证的是 token 取值，管不到运行时被 opacity 稀释掉的部分，
	 * 于是「主按钮标签在 hover 时对比度下降」这件事没有任何东西会报警。
	 *
	 * 只加阴影、不加位移（理由见 .btn 里那段说明：按钮在光标下移动
	 * 会让 Playwright 的稳定性检查永远不通过，也是真实的误点来源）。
	 */
	.btn-primary:not(:disabled):hover {
		box-shadow: var(--shadow-lift);
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
