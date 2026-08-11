<script lang="ts">
	/**
	 * 注意力权重热力图 —— **观察型交互**。
	 *
	 * 与 KvCacheSandbox 的形态差异是刻意的：
	 * 注意力机制没有「显存 vs 质量」那种天然的双约束，
	 * 硬凑一个出来只会编造数字。按 docs/level-authoring.md 的退路 1，
	 * 这里做成「预测再验证」：用户先猜切换某个开关会发生什么，再动手切。
	 *
	 * 所以这个组件**没有通关判定**，也不该有。
	 * 它的价值在于把三件抽象的事变成看得见的：
	 * 因果掩码屏蔽了什么、缩放因子防止了什么、softmax 归一化了什么。
	 */

	/** 可调的序列长度。上限 12 是为了每个格子还能看清数字 */
	const SEQ_OPTIONS = [4, 6, 8, 12] as const;
	/** 特征维度。取 64 是为了让「不缩放会饱和」的效果足够明显 */
	const HEAD_DIM = 64;

	let seqLen = $state<number>(6);
	let causal = $state(true);
	let scaled = $state(true);
	/** 悬停的格子，用于显示精确值 */
	let hovered = $state<{ i: number; j: number } | null>(null);

	/**
	 * 确定性伪随机数（mulberry32）。
	 *
	 * 必须确定性：用 Math.random 的话每次刷新热力图都变，
	 * 用户没法对比「切换开关前后」的差异，而这正是本组件的全部意义。
	 */
	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** 标准正态，Box-Muller */
	function gaussian(rand: () => number): number {
		const u = Math.max(rand(), 1e-12);
		const v = rand();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}

	/** 生成固定种子的 Q、K 矩阵 */
	function makeQK(n: number, d: number) {
		const rand = mulberry32(20260809);
		const Q: number[][] = [];
		const K: number[][] = [];
		for (let i = 0; i < n; i++) {
			Q.push(Array.from({ length: d }, () => gaussian(rand)));
			K.push(Array.from({ length: d }, () => gaussian(rand)));
		}
		return { Q, K };
	}

	function dot(a: number[], b: number[]): number {
		let s = 0;
		for (let i = 0; i < a.length; i++) s += a[i] * b[i];
		return s;
	}

	/** 数值稳定的 softmax，与代码题里要求实现的是同一套逻辑 */
	function softmax(xs: number[]): number[] {
		const finite = xs.filter((x) => Number.isFinite(x));
		const m = finite.length > 0 ? Math.max(...finite) : 0;
		const exps = xs.map((x) => (Number.isFinite(x) ? Math.exp(x - m) : 0));
		const total = exps.reduce((a, b) => a + b, 0);
		return exps.map((e) => (total > 0 ? e / total : 0));
	}

	const computed = $derived.by(() => {
		const n = seqLen;
		const { Q, K } = makeQK(n, HEAD_DIM);
		const scale = scaled ? 1 / Math.sqrt(HEAD_DIM) : 1;

		const rawScores: number[][] = [];
		const weights: number[][] = [];

		for (let i = 0; i < n; i++) {
			const row: number[] = [];
			for (let j = 0; j < n; j++) {
				// 因果掩码：未来位置置为负无穷，softmax 后权重恰好为 0
				row.push(causal && j > i ? Number.NEGATIVE_INFINITY : dot(Q[i], K[j]) * scale);
			}
			rawScores.push(row);
			weights.push(softmax(row));
		}

		// 分布的尖锐程度用熵度量：熵越低越集中。
		// 关掉缩放后熵会明显下降 —— 这就是「softmax 饱和」的量化表现。
		let entropySum = 0;
		for (const row of weights) {
			let h = 0;
			for (const p of row) if (p > 0) h -= p * Math.log2(p);
			entropySum += h;
		}
		const avgEntropy = entropySum / n;

		// 每行的最大权重，反映注意力有多集中
		const avgMaxWeight = weights.reduce((acc, row) => acc + Math.max(...row), 0) / n;

		// 分数的绝对值范围，用来说明缩放把什么压回了合理区间
		const finiteScores = rawScores.flat().filter((x) => Number.isFinite(x));
		const maxAbsScore = Math.max(...finiteScores.map(Math.abs));

		return { n, weights, rawScores, avgEntropy, avgMaxWeight, maxAbsScore };
	});

	/** 每行权重之和，验证 softmax 归一化 */
	const rowSums = $derived(computed.weights.map((r) => r.reduce((a, b) => a + b, 0)));

	/** 均匀分布的熵，作为对照上界 */
	const uniformEntropy = $derived(Math.log2(computed.n));

	/**
	 * 格子里数字改用深色前景的亮度阈值。
	 *
	 * 色阶从 L=0.32 走到 L=0.74，单一近白前景在亮端只有 1.87:1——可读性与数值
	 * **反相关**，越是要重点看的高权重格子越读不清。两个前景（纯白 / 近黑）在
	 * 这个切换点上最差 4.53:1，全色阶达标；换成别的阈值会让切换点附近掉到 4.5 以下。
	 */
	const HEAT_FG_FLIP = 0.543;

	/**
	 * 格子强度 → 0..1 的插值参数。
	 *
	 * 实际颜色由 CSS 在 `--color-heat-lo` 与 `--color-heat-hi` 之间用
	 * `color-mix(in oklch)` 插出来。这里刻意只返回一个数、不返回颜色：
	 * 颜色字面量留在 JS 里的话，`palette.spec.ts` 的收敛门禁扫不到它
	 * （它扫的是 CSS 里 `oklch(` 后面紧跟数字的形式，模板字符串正好躲过去）。
	 *
	 * 这与原先手算 `oklch(0.32 + t*0.42, 0.04 + t*0.13, 200)` 逐像素等价：
	 * oklch 插值对 L/C/H 分别做线性混合，端点取 t=0 与 t=1 的值即可复现同一条曲线。
	 */
	function cellIntensity(w: number): number {
		if (w <= 0) return 0;
		return Math.min(1, Math.pow(w, 0.55));
	}
</script>

<section class="viz" aria-labelledby="attn-viz-title">
	<header>
		<h3 id="attn-viz-title">🔍 观察：注意力权重矩阵</h3>
		<p class="lede">
			这里不需要通关。<strong>先猜</strong>切换开关会发生什么，再动手验证——
			猜错的地方就是你真正学到东西的地方。
		</p>
	</header>

	<div class="controls">
		<fieldset>
			<legend>序列长度</legend>
			<div class="chips">
				{#each SEQ_OPTIONS as n (n)}
					<label class="chip">
						<input type="radio" name="seq" value={n} bind:group={seqLen} />
						<span>{n}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<div class="toggles">
			<label class="toggle">
				<input type="checkbox" bind:checked={causal} />
				<span class="toggle-body">
					<span class="toggle-name">因果掩码</span>
					<span class="toggle-note">禁止看未来位置</span>
				</span>
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={scaled} />
				<span class="toggle-body">
					<span class="toggle-name">除以 √d_k</span>
					<span class="toggle-note"
						>d_k = {HEAD_DIM}，缩放因子 {(1 / Math.sqrt(HEAD_DIM)).toFixed(3)}</span
					>
				</span>
			</label>
		</div>
	</div>

	<div class="grid-wrap">
		<div
			class="grid"
			style="--n: {computed.n}"
			role="img"
			aria-label="注意力权重热力图，{computed.n} 乘 {computed.n}"
		>
			{#each computed.weights as row, i (i)}
				{#each row as w, j (j)}
					<button
						type="button"
						class="cell"
						class:masked={causal && j > i}
						class:on-bright={cellIntensity(w) >= HEAT_FG_FLIP}
						style="--t: {cellIntensity(w)}"
						onmouseenter={() => (hovered = { i, j })}
						onmouseleave={() => (hovered = null)}
						onfocus={() => (hovered = { i, j })}
						onblur={() => (hovered = null)}
						aria-label="位置 {i} 对 {j} 的权重 {w.toFixed(3)}"
					>
						<span class="cell-text">{w >= 0.005 ? w.toFixed(2).slice(1) : ''}</span>
					</button>
				{/each}
			{/each}
		</div>

		<div class="axis-note">
			<span>行 = 查询位置（当前 token）</span>
			<span>列 = 键位置（被注意的 token）</span>
		</div>
	</div>

	<div class="hover-readout" aria-live="polite">
		{#if hovered}
			<code>
				位置 {hovered.i} → {hovered.j}：权重 {computed.weights[hovered.i][hovered.j].toFixed(4)}
				{#if Number.isFinite(computed.rawScores[hovered.i][hovered.j])}
					（原始分数 {computed.rawScores[hovered.i][hovered.j].toFixed(2)}）
				{:else}
					（已被掩码，分数 −∞）
				{/if}
			</code>
		{:else}
			<code class="dim">悬停或聚焦任意格子查看精确数值</code>
		{/if}
	</div>

	<div class="metrics">
		<div class="metric">
			<span class="metric-label">每行权重之和</span>
			<span class="metric-value" data-testid="row-sum">
				{rowSums.every((s) => Math.abs(s - 1) < 1e-9) ? '全部为 1.000' : '异常'}
			</span>
			<span class="metric-note">softmax 的归一化保证：每个查询的注意力总量恒为 1</span>
		</div>

		<div class="metric">
			<span class="metric-label">平均熵</span>
			<span class="metric-value" data-testid="entropy">
				{computed.avgEntropy.toFixed(2)} / {uniformEntropy.toFixed(2)} bit
			</span>
			<span class="metric-note"> 右侧是均匀分布的上界。熵越低说明注意力越集中在少数位置 </span>
		</div>

		<div class="metric">
			<span class="metric-label">分数绝对值上限</span>
			<span class="metric-value" data-testid="max-score">
				{computed.maxAbsScore.toFixed(1)}
			</span>
			<span class="metric-note">进入 softmax 之前的量级。超过 ±10 就开始饱和</span>
		</div>
	</div>

	<div class="insight" data-testid="insight">
		{#if !scaled && !causal}
			<p>
				<strong>不缩放的后果已经显现。</strong>
				分数绝对值上限到了 {computed.maxAbsScore.toFixed(1)}，平均熵掉到
				{computed.avgEntropy.toFixed(2)} bit（均匀分布是 {uniformEntropy.toFixed(2)}）。
				注意力几乎全押在单个位置上——这种近似 one-hot 的输出让 softmax 落进饱和区， 梯度趋近于
				0，训练推不动。把「除以 √d_k」打开对比一下。
			</p>
		{:else if !scaled}
			<p>
				<strong>缩放关闭中。</strong>
				注意每行的最大权重（{(computed.avgMaxWeight * 100).toFixed(0)}%）比开启缩放时高得多。 d_k = {HEAD_DIM}
				使点积标准差约 {Math.sqrt(HEAD_DIM).toFixed(1)}， softmax 的输入被拉得过宽。
			</p>
		{:else if causal}
			<p>
				<strong>这是自回归模型训练时的真实形态。</strong>
				上三角全为 0——位置 i 看不到任何 j &gt; i。 第 0 行只有一个可见位置，所以它的权重必然是 1.000，无论分数是多少。
				这也解释了为什么第一个 token 的表示总是最"贫乏"的。
			</p>
		{:else}
			<p>
				<strong>双向注意力形态</strong>，BERT 这类编码器用的就是它。
				每个位置都能看到全序列，所以熵比因果掩码时高。
				试着打开因果掩码，观察上三角如何归零、熵如何下降。
			</p>
		{/if}
	</div>

	<p class="disclaimer">
		Q、K 由固定种子生成，所以切换开关时矩阵内容不变，差异只来自你改的那个设置。 这里的 softmax
		与代码题里要你实现的是同一套逻辑。
	</p>
</section>

<style>
	.viz {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
		padding: 1.75rem;
		display: grid;
		gap: 1.5rem;
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
		color: var(--color-text-muted);
		margin-bottom: 0.5rem;
	}

	.chips {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.chip {
		padding: 0.4375rem 0.9375rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 8px;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 0.9375rem;
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

	.toggles {
		display: grid;
		gap: 0.5rem;
	}

	@media (min-width: 34rem) {
		.toggles {
			grid-template-columns: 1fr 1fr;
		}
	}

	.toggle {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		cursor: pointer;
	}

	.toggle:has(input:checked) {
		border-color: var(--color-accent);
	}

	.toggle:has(input:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.toggle input {
		margin: 0.25rem 0 0;
		accent-color: var(--color-accent);
		flex: 0 0 auto;
	}

	.toggle-body {
		display: grid;
		gap: 0.1875rem;
	}

	.toggle-name {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.toggle-note {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.grid-wrap {
		display: grid;
		gap: 0.625rem;
		justify-items: center;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		gap: 2px;
		width: min(100%, 26rem);
		aspect-ratio: 1;
		/*
		 * 画布刻意是深色（两套主题相同）。热力图是数据可视化，色阶方向必须固定；
		 * 画布同时给了矩阵一个真实的外边界——没有它，矩阵的上/右边界由数据形状
		 * 而不是容器决定，读者数不清列到哪结束，也就对不上「行=查询、列=键」。
		 */
		background: var(--color-heat-canvas);
		padding: 4px;
		border-radius: 8px;
	}

	.cell {
		border: 0;
		padding: 0;
		border-radius: 2px;
		cursor: pointer;
		display: grid;
		place-items: center;
		font-family: var(--font-mono);
		font-size: clamp(0.625rem, 1.4vw, 0.6875rem);
		color: var(--color-on-heat);
		transition: outline-color 120ms ease;
		outline: 1px solid transparent;
		min-width: 0;
		/* --t 由标记内联给出（0..1）。见 cellIntensity 的注释 */
		background: color-mix(
			in oklch,
			var(--color-heat-hi) calc(var(--t) * 100%),
			var(--color-heat-lo)
		);
	}

	/* 色阶亮端的格子必须换深色前景，理由见 HEAT_FG_FLIP */
	.cell.on-bright {
		color: var(--color-on-heat-dark);
	}

	.cell:hover,
	.cell:focus-visible {
		outline-color: var(--color-on-heat-outline);
	}

	.cell.masked {
		background: repeating-linear-gradient(
			45deg,
			var(--color-heat-mask-a),
			var(--color-heat-mask-a) 3px,
			var(--color-heat-mask-b) 3px,
			var(--color-heat-mask-b) 6px
		) !important;
	}

	.cell-text {
		pointer-events: none;
	}

	.axis-note {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
		justify-content: center;
		font-size: 0.75rem;
		color: var(--color-text-faint);
	}

	.hover-readout code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.hover-readout .dim {
		color: var(--color-text-faint);
	}

	.metrics {
		display: grid;
		gap: 1rem;
	}

	@media (min-width: 46rem) {
		.metrics {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.metric {
		display: grid;
		gap: 0.3125rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-radius: 9px;
	}

	.metric-label {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.metric-value {
		font-family: var(--font-mono);
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--color-accent);
	}

	.metric-note {
		font-size: 0.75rem;
		line-height: 1.6;
		color: var(--color-text-faint);
	}

	.insight p {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.75;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-accent);
		border-radius: 8px;
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
