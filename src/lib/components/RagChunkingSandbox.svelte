<script lang="ts">
	/**
	 * RAG 分块策略沙盒 —— **达标型沙盒**。
	 *
	 * 三重约束场景：企业知识库，文档总字符 3,000,000，
	 * 用 Contextual Retrieval 机制为每个 chunk 生成上下文前缀
	 * （笔记 03-高级RAG策略.md：为每个 chunk 添加上下文说明，由 LLM 生成，
	 *  每个 chunk 都要单独调用一次 LLM，重复付一次这笔开销）。
	 *
	 * 可调两个维度：chunk_size、chunk_overlap（以百分比表示）。
	 *
	 * 约束 1：召回率（示意性估算）≥ 60%       —— chunk 太小或太大都会掉
	 * 约束 2：噪声比（示意性估算）≤ 42%        —— chunk 越大越容易混入不相关内容
	 * 约束 3：处理总成本（精确计算）≤ $2.00    —— chunk 越小，chunk 数越多，
	 *         "每个 chunk 单独调用一次 LLM 生成前缀"这笔按次计费的开销就被
	 *         重复收取更多次，成本被推高
	 *
	 * 冲突来源：直觉上"分块越小，语义越精确，召回率应该越高"，但
	 * chunk 数暴增会让 Contextual Retrieval 的前缀生成成本远超预算——
	 * "越小越好"在成本维度上必然失败。而 chunk 越大，虽然前缀生成成本降低，
	 * 但混入不相关内容的噪声比会超标，同时召回率也会因为单块语义被稀释而下降。
	 * 可行解只存在于中间地带。
	 *
	 * 沙盒设计已用脚本枚举全部 4×3=12 个组合确认（脚本已删除，结果记录于此）：
	 *
	 *   chunk_size \ overlap   0%       15%      30%
	 *   150（"越小越精确"直觉）成本✗    成本✗    成本✗
	 *   400                   ✅可行    ✅可行    成本✗
	 *   900                   ✅可行    噪声✗    噪声✗
	 *   1600                  召回✗噪声✗ 召回✗噪声✗ 召回✗噪声✗
	 *
	 *   12 个组合中恰好 3 个可行（400/0%、400/15%、900/0%），不超过一半。
	 *   失败原因分布在三侧：3 个因召回不足失败，5 个因噪声超标失败，
	 *   4 个因成本超标失败（其中 1600 的三个组合同时召回+噪声两项超标）。
	 *   "分块越小越好"验证：chunk_size=150 的三个组合无一可行，全部因成本超标失败——
	 *   直觉上"越小越精确"应该最优，但 chunk 数暴增到 2 万+，
	 *   Contextual Retrieval 前缀生成的按次调用成本远超预算，必须理解
	 *   "chunk 数量本身是一项独立成本"才能找到可行解。
	 */

	import ConstraintGauge from './ConstraintGauge.svelte';
	import OptionChips from './OptionChips.svelte';
	import { allSatisfied } from '$lib/sandbox/constraints';

	/** 场景固定参数 */
	const SCENARIO = {
		totalChars: 3_000_000,
		/** 每个 chunk 生成上下文前缀时，调用 LLM 的固定 prompt 开销（token） */
		promptOverheadTokens: 200,
		/** 生成的上下文前缀长度（token） */
		prefixOutputTokens: 60
	} as const;

	/** 假设单价，均非任何厂商真实定价 */
	const PRICING = {
		/** 前缀生成用的 LLM 单价（远高于 embedding 单价，因为是生成式调用） */
		llmPriceInPerMillion: 0.25,
		llmPriceOutPerMillion: 1.25,
		/** 嵌入单价 */
		embedPricePerMillion: 0.02
	} as const;

	/** 中文经验比例：约 1.5 字/token（示意性估算，与 tokenizer/rag-chunking 题库一致） */
	const ZH_CHARS_PER_TOKEN = 1.5;

	/** 三重约束（召回率与噪声比为示意性估算的阈值，成本为精确计算的预算上限） */
	const CONSTRAINTS = {
		recallMin: 0.6,
		noiseMax: 0.42,
		costMaxUsd: 2.0
	} as const;

	const CHUNK_SIZE_OPTIONS = [
		{ id: 'cs150', label: '150 字符', detail: '"越小越精确"直觉', value: 150 },
		{ id: 'cs400', label: '400 字符', detail: '中等粒度', value: 400 },
		{ id: 'cs900', label: '900 字符', detail: '偏大粒度', value: 900 },
		{ id: 'cs1600', label: '1600 字符', detail: '大块拼接', value: 1600 }
	] as const;

	const OVERLAP_OPTIONS = [
		{ id: 'ov0', label: '0%', value: 0 },
		{ id: 'ov15', label: '15%', value: 0.15 },
		{ id: 'ov30', label: '30%', value: 0.3 }
	] as const;

	let chunkSizeId = $state<string>('cs150');
	let overlapId = $state<string>('ov0');

	const chunkSizeOpt = $derived(CHUNK_SIZE_OPTIONS.find((o) => o.id === chunkSizeId)!);
	const overlapOpt = $derived(OVERLAP_OPTIONS.find((o) => o.id === overlapId)!);

	const chunkSize = $derived(chunkSizeOpt.value);
	const overlapPct = $derived(overlapOpt.value);

	/** chunk 数量：滑动窗口公式，overlap 换算成字符后取整 */
	const nChunks = $derived.by(() => {
		const overlapChars = Math.round(chunkSize * overlapPct);
		const stride = chunkSize - overlapChars;
		return Math.ceil((SCENARIO.totalChars - chunkSize) / stride) + 1;
	});

	/** 每个 chunk 正文的 token 数（示意性估算） */
	const bodyTokensPerChunk = $derived(chunkSize / ZH_CHARS_PER_TOKEN);

	/** 前缀生成成本：每个 chunk 单独调用一次 LLM，input = 正文 + 固定开销，output = 前缀长度 */
	const prefixGenCostUsd = $derived(
		nChunks *
			(((bodyTokensPerChunk + SCENARIO.promptOverheadTokens) / 1_000_000) *
				PRICING.llmPriceInPerMillion +
				(SCENARIO.prefixOutputTokens / 1_000_000) * PRICING.llmPriceOutPerMillion)
	);

	/** 嵌入成本：正文 + 前缀一起嵌入 */
	const embedCostUsd = $derived(
		((nChunks * (bodyTokensPerChunk + SCENARIO.prefixOutputTokens)) / 1_000_000) *
			PRICING.embedPricePerMillion
	);

	const totalCostUsd = $derived(prefixGenCostUsd + embedCostUsd);

	/** 召回率示意性估算：chunk_size 偏离 600（理想值）越远越差，重叠适度提升 */
	const recall = $derived.by(() => {
		const ideal = 600;
		const r = 0.8 - ((chunkSize - ideal) ** 2 / 700 ** 2) * 0.35 + overlapPct * 0.12;
		return Math.max(0.05, Math.min(0.95, r));
	});

	/** 噪声比示意性估算：chunk 越大越容易混入不相关内容，重叠也略增加重复噪声 */
	const noise = $derived.by(() => {
		const nz = 0.1 + (chunkSize / 1600) * 0.55 + overlapPct * 0.15;
		return Math.max(0.05, Math.min(0.95, nz));
	});

	const okRecall = $derived(recall >= CONSTRAINTS.recallMin);
	const okNoise = $derived(noise <= CONSTRAINTS.noiseMax);
	const okCost = $derived(totalCostUsd <= CONSTRAINTS.costMaxUsd);
	const solved = $derived(allSatisfied([okRecall, okNoise, okCost]));

	let solvedOnce = $state(false);

	interface Props {
		onSolved?: () => void;
	}
	let { onSolved }: Props = $props();

	$effect(() => {
		if (solved && !solvedOnce) {
			solvedOnce = true;
			onSolved?.();
		}
	});

	function fmtPct(n: number): string {
		return `${(n * 100).toFixed(1)}%`;
	}

	function fmtCost(n: number): string {
		return `$${n.toFixed(3)}`;
	}

	function fmtCount(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
	}
</script>

<section class="sandbox" data-solved={solved} aria-labelledby="rag-chunking-sandbox-title">
	<header class="head">
		<h3 id="rag-chunking-sandbox-title">🎯 关卡：在召回率、噪声、成本之间找到可行区间</h3>
		<p class="scenario">
			知识库文档共 {fmtCount(SCENARIO.totalChars)} 字符 · 用 Contextual Retrieval 为每个 chunk 生成上下文前缀
			<br />
			每个 chunk 都要单独调用一次 LLM（固定 prompt 开销 {SCENARIO.promptOverheadTokens} token + 前缀 {SCENARIO.prefixOutputTokens}
			token）
		</p>
		<p class="goal">
			同时满足三个约束：<b>召回率 ≥ {fmtPct(CONSTRAINTS.recallMin)}</b>
			、<b>噪声比 ≤ {fmtPct(CONSTRAINTS.noiseMax)}</b>
			、<b>处理总成本 ≤ {fmtCost(CONSTRAINTS.costMaxUsd)}</b>
		</p>
	</header>

	<div class="controls">
		<OptionChips
			legend="chunk_size（分块大小）"
			name="chunkSize"
			options={CHUNK_SIZE_OPTIONS}
			bind:value={chunkSizeId}
		/>
		<OptionChips
			legend="chunk_overlap（重叠比例）"
			name="overlap"
			options={OVERLAP_OPTIONS}
			bind:value={overlapId}
		/>
	</div>

	<div class="gauges" aria-live="polite">
		<!-- 召回率是下限型约束：分母用 1（整个百分比量程）而不是阈值，
		     否则达标时进度条永远是满的，看不出还剩多少余量 -->
		<ConstraintGauge
			name="召回率（示意性估算）"
			value={fmtPct(recall)}
			testId="recall-value"
			ok={okRecall}
			current={recall}
			scale={1}
			budgetLabel={`下限 ${fmtPct(CONSTRAINTS.recallMin)}`}
			verdict={okRecall ? '达标' : '不足'}
		/>

		<ConstraintGauge
			name="噪声比（示意性估算）"
			value={fmtPct(noise)}
			testId="noise-value"
			ok={okNoise}
			current={noise}
			scale={1}
			budgetLabel={`上限 ${fmtPct(CONSTRAINTS.noiseMax)}`}
			verdict={okNoise ? '达标' : '超标'}
		/>

		<ConstraintGauge
			name="处理总成本"
			value={fmtCost(totalCostUsd)}
			testId="cost-value"
			ok={okCost}
			current={totalCostUsd}
			scale={CONSTRAINTS.costMaxUsd}
			budgetLabel={`预算 ${fmtCost(CONSTRAINTS.costMaxUsd)}`}
			verdict={okCost ? '在预算内' : '超支'}
		/>
	</div>

	<div class="readout">
		<code data-testid="chunk-count-value">
			{fmtCount(SCENARIO.totalChars)} 字 ÷ {chunkSize} 字符/块（重叠 {fmtPct(overlapPct)}） ≈ {fmtCount(
				nChunks
			)} 个 chunk
		</code>
		<code>
			前缀生成成本 {fmtCost(prefixGenCostUsd)}（{fmtCount(nChunks)} 次 LLM 调用） + 嵌入成本 {fmtCost(
				embedCostUsd
			)} = {fmtCost(totalCostUsd)}
		</code>
	</div>

	<div class="status" role="status">
		{#if solved}
			<p class="status-ok">
				✅ 达标。这个分块粒度同时满足召回率、噪声比、成本三个约束。
				<br />
				注意最小的 150 字符分块看起来"最精确"，但 chunk 数暴增到 2 万+， 每个 chunk 都要单独调用一次 LLM
				生成上下文前缀，这笔按次计费的成本远超预算—— 可行解只在中间地带，不是"越小越好"。
			</p>
		{:else if !okCost && chunkSize <= 400}
			<p class="status-bad">
				成本超支了。chunk 越小，chunk 总数越多，"每个 chunk 单独调用一次 LLM"的固定开销
				被重复收取的次数也越多——试试增大 chunk_size 减少 chunk 数量。
			</p>
		{:else if !okNoise || (!okRecall && chunkSize > 900)}
			<p class="status-bad">
				chunk 太大，混入了更多不相关内容（噪声超标），单块语义也被稀释导致召回率下降—— 试试调小
				chunk_size。
			</p>
		{:else}
			<p class="status-bad">召回率不足。试试调整 chunk_size 或增加重叠比例。</p>
		{/if}
	</div>

	<p class="disclaimer">
		chunk 数量、成本是精确计算（给定假设单价与场景参数）。召回率和噪声比是<b>示意性估算</b>，
		用于体现"分块粒度影响检索质量"的方向和量级关系，不代表某次具体评测结果——
		真实数值取决于文档类型、embedding 模型和查询分布。单价均为假设值，非任何厂商真实定价。
	</p>
</section>

<style>
	.sandbox {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
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
		color: var(--color-text-muted);
	}

	.goal {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.7;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-accent);
		border-radius: var(--radius-control);
	}

	.controls {
		display: grid;
		gap: 1.125rem;
	}

	.gauges {
		display: grid;
		gap: 1rem;
	}

	@media (min-width: 40rem) {
		.gauges {
			grid-template-columns: 1fr 1fr 1fr;
		}
	}

	.readout {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-radius: var(--radius-control);
	}

	.readout code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--color-text);
		word-break: break-word;
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
		color: var(--color-text-faint);
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 0.875rem;
	}
</style>
