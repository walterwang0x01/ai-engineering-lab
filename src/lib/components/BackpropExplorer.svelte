<script lang="ts">
	/**
	 * 反向传播梯度流探索器 —— **观察型交互**。
	 *
	 * 反向传播本身没有 KV Cache 那种「显存 vs 质量」的天然双约束，
	 * 硬凑一个双约束只会编造数字。按 docs/level-authoring.md 的退路 1，
	 * 这里做成「预测再验证」：用户先猜拖动 x1 会发生什么，再动手拖。
	 *
	 * 所以这个组件**没有通关判定**，也不该有。
	 *
	 * 网络与题库共用同一套固定参数（见 backprop-questions.ts 的 BACKPROP_NET），
	 * 只有 x1 是可调的——这样用户在这里看到的现象，和题库里手算的数字是同一件事。
	 *
	 * 核心教学点：拖动 x1 让 z2 从正变负，观察 ReLU'(z2) 从 1 掉到 0，
	 * 整条反向传播链路（δ2 → w21/w22/b2 的梯度）随之归零——
	 * 死亡不是渐变的削弱，是阶跃的截断。
	 */
	import { BACKPROP_NET, BACKPROP_INPUT } from '$lib/quiz/backprop-questions';
	import Mascot from '$lib/components/Mascot.svelte';

	const NET = BACKPROP_NET;

	/** x1 可调范围，覆盖题库里的临界点 x1≈2.33 两侧 */
	const X1_MIN = -3;
	const X1_MAX = 4;
	const X1_STEP = 0.05;

	let x1 = $state<number>(BACKPROP_INPUT.x1);
	/**
	 * 用户是否动过滑块。
	 *
	 * 顶部写着「先猜…再动手拖」，但结论那一大段原来在页面加载时就全文展开，
	 * 答案就在「猜」的下方三厘米处——零上下文复查者的原话是
	 * 「'猜'这个动作没有意义」。所以结论等动手之后再出现。
	 */
	let touched = $state(false);
	/** x2、y 固定，与题库一致，只让 x1 可调以保持交互聚焦在单一变量上 */
	const x2 = BACKPROP_INPUT.x2;
	const y = BACKPROP_INPUT.y;

	function relu(z: number): number {
		return Math.max(0, z);
	}
	function reluGrad(z: number): number {
		return z > 0 ? 1 : 0;
	}

	const computed = $derived.by(() => {
		const z1 = NET.w11 * x1 + NET.w12 * x2 + NET.b1;
		const z2 = NET.w21 * x1 + NET.w22 * x2 + NET.b2;
		const h1 = relu(z1);
		const h2 = relu(z2);
		const out = NET.v1 * h1 + NET.v2 * h2 + NET.c;
		const L = (out - y) ** 2;

		const dOut = 2 * (out - y);
		const dH1 = dOut * NET.v1;
		const dH2 = dOut * NET.v2;
		const g1 = reluGrad(z1);
		const g2 = reluGrad(z2);
		const dZ1 = dH1 * g1;
		const dZ2 = dH2 * g2;

		return {
			z1,
			z2,
			h1,
			h2,
			out,
			L,
			dOut,
			dH1,
			dH2,
			g1,
			g2,
			dZ1,
			dZ2,
			dW11: dZ1 * x1,
			dW12: dZ1 * x2,
			dB1: dZ1,
			dW21: dZ2 * x1,
			dW22: dZ2 * x2,
			dB2: dZ2,
			alive1: z1 > 0,
			alive2: z2 > 0
		};
	});

	/** 令 z2 = 0 的临界 x1（固定 x2、b2、w21 时的反解），用于标注滑块上的分界点 */
	const criticalX1 = $derived((0 - NET.w22 * x2 - NET.b2) / NET.w21);
	/**
	 * 上游误差那段说明。按 h2 是否存活切换，且拼成单一字符串——
	 * 模板里用 `{#if}` 拼接会被 Svelte 吃掉前导空白，中英混排处少一个空格。
	 */
	const upstreamNote = $derived.by(() => {
		const delta = `上游误差 δ_h2 = ∂L/∂h2 = ${fmt(computed.dH2, 3)}`;
		const self = computed.dH2 === 0 ? '（恰好也是 0）' : '（本身不是 0）';
		return computed.alive2
			? `${delta}${self}。此刻 z2 = ${fmt(computed.z2, 2)} > 0，ReLU'(z2) = 1，` +
					'上游误差原样传了下去，所以 w21/w22/b2 的梯度都不是 0——这一侧还在学。' +
					'把 x1 拖回临界点左边，看它们怎么一起归零。'
			: `${delta}${self}。死亡的关键在 ReLU'(z2)，不在上游误差本身：` +
					'即使上游传来非零信号，乘上 0 之后，h2 这一侧的三个参数梯度必然全部归零。';
	});

	const criticalPercent = $derived(((criticalX1 - X1_MIN) / (X1_MAX - X1_MIN)) * 100);

	function fmt(n: number, digits = 2): string {
		return n.toFixed(digits);
	}
</script>

<section class="explorer" aria-labelledby="backprop-explorer-title">
	<header>
		<h3 id="backprop-explorer-title">🔍 观察：拖动输入，看梯度链路怎么断</h3>
		<p class="lede">
			这里不需要通关。<strong>先猜</strong>把 x1 拖到滑块右侧会发生什么，再动手拖——
			猜错的地方就是你真正学到东西的地方。
		</p>
	</header>

	<div class="net-diagram" aria-hidden="true">
		<div class="col">
			<span class="col-label">输入</span>
			<!--
				这两个框原来带圆角描边 + 等宽字体，和真输入框视觉一致，
				复查者第一个动作就是去点它想改数字。现在去掉输入框外观，
				可调的那一个明确标出「用下面的滑块调」。
			-->
			<div class="node readout">x1 = {fmt(x1)} <span class="readout-hint">滑块可调 ↓</span></div>
			<div class="node readout dim">x2 = {fmt(x2)} <span class="readout-hint">固定</span></div>
		</div>
		<div class="col">
			<span class="col-label">隐藏层</span>
			<div class="node" class:alive={computed.alive1} class:dead={!computed.alive1}>
				<span class="node-name">h1</span>
				<span class="node-value">{fmt(computed.h1)}</span>
			</div>
			<div class="node" class:alive={computed.alive2} class:dead={!computed.alive2}>
				<span class="node-name">h2</span>
				<span class="node-value">{fmt(computed.h2)}</span>
			</div>
		</div>
		<div class="col">
			<span class="col-label">输出</span>
			<div class="node output">
				<span class="node-name">out</span>
				<span class="node-value">{fmt(computed.out)}</span>
			</div>
		</div>
	</div>

	<div class="control">
		<div class="control-head">
			<label for="x1-slider">x1</label>
			<span class="control-value" data-testid="x1-value">{fmt(x1)}</span>
		</div>
		<!-- 滑块此前没有可访问名称：屏幕阅读器只会听到一个没名字的滑块 -->
		<input
			id="x1-slider"
			type="range"
			min={X1_MIN}
			max={X1_MAX}
			step={X1_STEP}
			bind:value={x1}
			oninput={() => (touched = true)}
			aria-label="输入 x1，临界点约 {fmt(criticalX1)}"
			aria-valuetext="x1 = {fmt(x1)}，h2 {computed.alive2 ? '存活' : '已死亡'}"
		/>
		<div class="slider-scale">
			<span>{X1_MIN}</span>
			<span class="critical-mark" style="left: {criticalPercent}%">
				临界点 x1 ≈ {fmt(criticalX1)}
			</span>
			<span>{X1_MAX}</span>
		</div>
		<p class="control-note">
			x2 = {fmt(x2)}、y = {fmt(y)} 固定，权重与偏置固定（与题库同一组参数）。只拖 x1， 便于把"发生了什么变化"精确归因到这一个变量。
		</p>
	</div>

	<div class="chain">
		<h4>反向传播链路：δ2 = ∂L/∂z2 → 三个参数的梯度</h4>
		<div class="chain-row">
			<div class="chain-cell">
				<span class="chain-label">z2</span>
				<span class="chain-value" data-testid="z2-value">{fmt(computed.z2)}</span>
			</div>
			<span class="chain-arrow">→</span>
			<div class="chain-cell">
				<span class="chain-label">ReLU'(z2)</span>
				<span class="chain-value" class:zero={computed.g2 === 0} data-testid="relu-grad-z2">
					{computed.g2}
				</span>
			</div>
			<span class="chain-arrow">→</span>
			<div class="chain-cell">
				<span class="chain-label">δ2 = ∂L/∂z2</span>
				<span class="chain-value" class:zero={computed.dZ2 === 0} data-testid="delta-z2">
					{fmt(computed.dZ2, 3)}
				</span>
			</div>
		</div>

		<div class="chain-row params">
			<div class="chain-cell">
				<span class="chain-label">∂L/∂w21</span>
				<span class="chain-value" class:zero={computed.dW21 === 0} data-testid="grad-w21">
					{fmt(computed.dW21, 3)}
				</span>
			</div>
			<div class="chain-cell">
				<span class="chain-label">∂L/∂w22</span>
				<span class="chain-value" class:zero={computed.dW22 === 0} data-testid="grad-w22">
					{fmt(computed.dW22, 3)}
				</span>
			</div>
			<div class="chain-cell">
				<span class="chain-label">∂L/∂b2</span>
				<span class="chain-value" class:zero={computed.dB2 === 0} data-testid="grad-b2">
					{fmt(computed.dB2, 3)}
				</span>
			</div>
		</div>

		<!--
			这段文案必须跟着 h2 的存活状态走。改版前它是固定的「必然全部归零」，
			于是 h2 存活时屏幕上同时出现 ∂L/∂w21 = -32.550（非零）和「必然全部归零」，
			零上下文复查的原话是「到底该信数字还是信文字」——停下来想了远超 5 秒。
		-->
		<p class="chain-upstream" data-testid="chain-upstream">{upstreamNote}</p>
	</div>

	<div class="status" class:dead={!computed.alive2} data-testid="status-banner">
		<!--
			吉祥物的身体就是 ReLU 折线，跟着 alive2 压平/上扬。
			刻意不传 label：下面这段文字已经把状态说全了，再给图形一个名字会让读屏
			把「已死亡」听两遍。它在这里是同一信息的视觉编码，不是额外信息。
		-->
		<Mascot size={44} state={computed.alive2 ? 'alive' : 'dead'} />
		<div class="status-body">
			{#if !touched}
				<p class="status-prompt">
					先猜：把 x1 往右拖过临界点 {fmt(criticalX1)}，<code>ReLU'(z2)</code> 那一栏会变成什么？ w21/w22/b2
					的梯度会跟着变吗？——拖一下，这里就会给出结论。
				</p>
			{:else if !computed.alive2}
				<p>
					<strong>h2 已死亡。</strong>
					z2 = {fmt(computed.z2)} ≤ 0，ReLU'(z2) = 0，δ2 归零，w21/w22/b2 的梯度全部为 0。 梯度下降的更新公式是
					<code>w ← w − η·∂L/∂w</code>，梯度为 0 意味着不管学习率多大、
					训练多少步，这三个参数这一步都不会变。只要 z2 依然 ≤ 0，下一步梯度仍然是 0——
					这就是"死亡"：不是暂时沉默，是训练本身没有能力把它救回来。
				</p>
			{:else}
				<p>
					<strong>h2 存活。</strong>
					z2 = {fmt(computed.z2)} &gt; 0，ReLU'(z2) = 1，误差可以正常传到 w21/w22/b2， 梯度下降能够继续修正这三个参数。把
					x1 拖到临界点 {fmt(criticalX1)} 以下， 看 h2 何时切换到死亡状态——切换的瞬间没有过渡，是阶跃式的。
				</p>
			{/if}
		</div>
	</div>

	<p class="disclaimer">
		网络参数与题库共用同一组固定值，仅 x1 可调。z1/h1（对应 w11/w12/b1）这一侧留作对照： 无论怎么拖
		x1，只要 z1 始终 &gt; 0，h1 就不会经历这里演示的死亡过程。
	</p>
</section>

<style>
	.explorer {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		padding: 1.75rem;
		display: grid;
		gap: 1.5rem;
		box-shadow: var(--shadow-card);
	}

	header {
		display: grid;
		gap: 0.5rem;
	}

	h3 {
		margin: 0;
		font-size: 1.125rem;
	}

	.lede {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.7;
		color: var(--color-text-soft);
	}

	.net-diagram {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		align-items: center;
	}

	.col {
		display: grid;
		gap: 0.5rem;
		justify-items: center;
	}

	.col-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-faint);
	}

	.node {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-control);
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		font-family: var(--font-mono);
		font-size: 0.875rem;
		text-align: center;
		display: grid;
		gap: 0.125rem;
		transition:
			border-color 160ms ease,
			background 160ms ease;
	}

	.node.readout {
		/* 不做输入框外观：无描边、左对齐、说明用小字，避免被当成可编辑 */
		background: none;
		border: 0;
		padding: 0.3125rem 0;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}

	.readout-hint {
		font-family: var(--font-sans);
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	.node.readout.dim {
		color: var(--color-text-muted);
	}

	.node.output {
		border-color: var(--color-accent);
	}

	.node.alive {
		border-color: var(--color-ok);
		background: color-mix(in oklch, var(--color-ok) 10%, var(--color-surface-sunken));
	}

	.node.dead {
		border-color: var(--color-bad);
		background: color-mix(in oklch, var(--color-bad) 10%, var(--color-surface-sunken));
	}

	.node-name {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.node-value {
		font-weight: 600;
	}

	.control {
		display: grid;
		gap: 0.5rem;
	}

	.control-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.control-head label {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.control-value {
		font-family: var(--font-mono);
		font-size: 1rem;
		color: var(--color-accent);
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--color-accent);
	}

	.slider-scale {
		position: relative;
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		height: 1.25rem;
	}

	.critical-mark {
		position: absolute;
		transform: translateX(-50%);
		font-family: var(--font-mono);
		color: var(--color-warn);
		white-space: nowrap;
	}

	/* 420px 下「临界点 x1 ≈ 2.33」和右端刻度 4 几乎贴在一起，挤成一团 */
	@media (max-width: 34rem) {
		.slider-scale {
			height: auto;
			flex-wrap: wrap;
			row-gap: 0.25rem;
		}

		.critical-mark {
			position: static;
			transform: none;
			order: 3;
			flex-basis: 100%;
			text-align: center;
		}
	}

	.control-note {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--color-text-faint);
	}

	.chain {
		display: grid;
		gap: 0.75rem;
	}

	.chain h4 {
		margin: 0;
		font-size: 0.9375rem;
	}

	.chain-row {
		display: flex;
		gap: 0.625rem;
		align-items: stretch;
		flex-wrap: wrap;
	}

	.chain-row.params {
		gap: 0.75rem;
	}

	.chain-cell {
		flex: 1;
		min-width: 6rem;
		display: grid;
		gap: 0.25rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface-sunken);
		border-radius: var(--radius-control);
		text-align: center;
	}

	.chain-arrow {
		display: grid;
		place-items: center;
		color: var(--color-text-faint);
		font-size: 1rem;
	}

	/*
	 * 窄屏：链路必须纵向堆叠。
	 *
	 * 改版前是 flex-wrap，420px 下第一行变成 `z2 → ReLU'(z2) →`，
	 * 第二个箭头悬在屏幕右缘指向空白，δ2 掉到下一行——而这个演示的
	 * 全部意义就是因果链的方向。零上下文复查者把它列为严重度 2。
	 */
	@media (max-width: 34rem) {
		.chain-row {
			flex-direction: column;
			align-items: stretch;
		}

		.chain-arrow {
			transform: rotate(90deg);
		}
	}

	.chain-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.chain-value {
		font-family: var(--font-mono);
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-ok);
	}

	.chain-value.zero {
		color: var(--color-bad);
	}

	.chain-upstream {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--color-text-muted);
	}

	.status-prompt {
		margin: 0;
		line-height: 1.75;
	}

	.status {
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-ok);
		border-radius: var(--radius-control);
		/* 吉祥物与文字并排。顶部对齐，文字多行时图形不跟着往下飘 */
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
		/* 吉祥物用 currentColor，所以整块的 color 决定它的颜色 */
		color: var(--color-ok);
	}

	.status-body {
		min-width: 0;
		color: var(--color-text-soft);
	}

	.status.dead {
		border-left-color: var(--color-bad);
		color: var(--color-bad);
	}

	.status p {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
	}

	.status code {
		font-family: var(--font-mono);
		font-size: 0.875em;
		background: var(--color-surface);
		padding: 0.05em 0.35em;
		border-radius: var(--radius-control);
	}

	.disclaimer {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.7;
		color: var(--color-text-faint);
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 0.875rem;
	}
</style>
