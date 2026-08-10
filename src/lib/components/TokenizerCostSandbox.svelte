<script lang="ts">
	/**
	 * Tokenizer 成本与上下文窗口沙盒 —— **达标型沙盒**。
	 *
	 * 双重约束场景：把一份 9000 字符的中文文档喂给 API 做摘要，
	 * 每月处理 1000 份。可调两个维度：
	 *   1. 分词器压缩率（不同分词器对中文的字符/token 比例不同）
	 *   2. 是否把文档切成多块分别请求
	 *
	 * 约束 1：单次调用的 input token 不能超过上下文窗口的安全额度
	 *         （窗口 4000 tokens × 85% 安全比例 = 3400 tokens）
	 * 约束 2：月度总成本 < $22（假设预算，非真实定价）
	 *
	 * 冲突来源：文档切得越碎，越容易塞进小窗口，但每一块都要重新付一次
	 * 固定的系统提示词 token（600），分块越多，这笔固定开销被重复收取的
	 * 次数越多，月度成本反而上升。压缩率越高的分词器越省 token，但也可能
	 * 让人误以为"一次性处理"就够了，结果依然超窗口。
	 *
	 * 沙盒设计已用脚本枚举全部 3×3=9 个组合确认（脚本已删除，结果记录于此）：
	 *
	 *   分词器 \ 分块        整篇一次    分2块      分4块
	 *   通用分词器(1.3)      窗口✗      窗口✗      预算✗
	 *   中文优化词表(2.2)    窗口✗      ✅可行      预算✗
	 *   字节级BPE(0.9)       窗口✗预算✗  窗口✗预算✗  预算✗
	 *
	 *   9 个组合中恰好 1 个可行（中文优化词表 + 分 2 块），不超过一半。
	 *   失败原因分布在两侧：5 个组合超窗口（其中 2 个同时超预算），
	 *   3 个组合仅超预算（分 4 块的三种分词器都因固定开销重复收取太多次而超支）。
	 *   "一路选最省"验证：压缩率最高（最省 token）的"中文优化词表" + "整篇一次处理"
	 *   直觉上应该最优，但 input_tokens_per_call ≈ 4690.9 > 3400，超窗口失败——
	 *   必须理解"分块能救窗口但要花系统提示词的重复成本"这个权衡才能找到可行解。
	 */

	import ConstraintGauge from './ConstraintGauge.svelte';
	import OptionChips from './OptionChips.svelte';
	import { allSatisfied } from '$lib/sandbox/constraints';

	/** 示意性分词器选项：字符/token 比例反映"对中文的压缩效率"差异 */
	const TOKENIZER_OPTIONS = [
		{ id: 'generic', label: '通用分词器', detail: '中文约 1.3 字/token', charsPerToken: 1.3 },
		{ id: 'zh_opt', label: '中文优化词表', detail: '中文约 2.2 字/token', charsPerToken: 2.2 },
		{ id: 'byte_bpe', label: '字节级 BPE', detail: '中文约 0.9 字/token', charsPerToken: 0.9 }
	] as const;

	const CHUNK_OPTIONS = [
		{ id: 'single', label: '整篇一次处理', chunks: 1 },
		{ id: 'chunk2', label: '分 2 块处理', chunks: 2 },
		{ id: 'chunk4', label: '分 4 块处理', chunks: 4 }
	] as const;

	/** 固定场景参数 */
	const SCENARIO = {
		docChars: 9000,
		/** 每次调用都要重复付这笔系统提示词开销 —— 分块越多，付得越多次 */
		systemPromptTokens: 600,
		outputTokensPerChunk: 300,
		requestsPerMonth: 1000
	} as const;

	/** 假设单价，非任何厂商真实定价 */
	const PRICING = { priceInPerMillion: 2.0, priceOutPerMillion: 8.0 } as const;

	/** 双重约束（预算与窗口安全额度均为本沙盒的假设值） */
	const BUDGET = {
		contextWindowTokens: 4000,
		windowSafetyRatio: 0.85,
		monthlyCostUsd: 22.0
	} as const;

	let tokenizerId = $state<string>('generic');
	let chunkId = $state<string>('single');

	const tokenizer = $derived(TOKENIZER_OPTIONS.find((o) => o.id === tokenizerId)!);
	const chunkPlan = $derived(CHUNK_OPTIONS.find((o) => o.id === chunkId)!);

	/** 整篇文档的 token 数（示意性估算：字符数 ÷ 字符/token 比例） */
	const docTokens = $derived(SCENARIO.docChars / tokenizer.charsPerToken);

	/** 每块文档部分的 token 数 */
	const tokensPerChunkDoc = $derived(docTokens / chunkPlan.chunks);

	/** 每次调用的 input token = 该块文档 token + 系统提示词（每次都要重新付） */
	const inputTokensPerCall = $derived(tokensPerChunkDoc + SCENARIO.systemPromptTokens);

	const windowBudgetTokens = $derived(BUDGET.contextWindowTokens * BUDGET.windowSafetyRatio);
	const fitsWindow = $derived(inputTokensPerCall <= windowBudgetTokens);

	/** 处理一份文档的总成本 = 块数 × 每块（输入成本 + 输出成本） */
	const costPerDocument = $derived(
		chunkPlan.chunks *
			((inputTokensPerCall / 1_000_000) * PRICING.priceInPerMillion +
				(SCENARIO.outputTokensPerChunk / 1_000_000) * PRICING.priceOutPerMillion)
	);
	const monthlyCostUsd = $derived(costPerDocument * SCENARIO.requestsPerMonth);
	const withinBudget = $derived(monthlyCostUsd < BUDGET.monthlyCostUsd);

	const solved = $derived(allSatisfied([fitsWindow, withinBudget]));
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

	function fmtTokens(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
	}

	function fmtCost(n: number): string {
		return `$${n.toFixed(2)}`;
	}
</script>

<section class="sandbox" data-solved={solved} aria-labelledby="tokenizer-sandbox-title">
	<header class="head">
		<h3 id="tokenizer-sandbox-title">🎯 关卡：让文档摘要任务同时不超窗口、不超预算</h3>
		<p class="scenario">
			每份文档 {SCENARIO.docChars} 字符 · 每月处理 {SCENARIO.requestsPerMonth} 份
			<br />
			系统提示词固定 {SCENARIO.systemPromptTokens} token/次调用 · 每块输出 {SCENARIO.outputTokensPerChunk}
			token
		</p>
		<p class="goal">
			同时满足两个约束：<b>单次调用 input ≤ {fmtTokens(windowBudgetTokens)} token（窗口安全额度）</b
			>
			且 <b>月度成本 &lt; {fmtCost(BUDGET.monthlyCostUsd)}</b>
		</p>
	</header>

	<div class="controls">
		<OptionChips
			legend="分词器（示意性压缩效率）"
			name="tokenizer"
			options={TOKENIZER_OPTIONS}
			bind:value={tokenizerId}
		/>
		<OptionChips legend="处理方式" name="chunk" options={CHUNK_OPTIONS} bind:value={chunkId} />
	</div>

	<div class="gauges" aria-live="polite">
		<ConstraintGauge
			name="单次调用 input token"
			value={`${fmtTokens(inputTokensPerCall)} token`}
			testId="input-tokens-value"
			ok={fitsWindow}
			current={inputTokensPerCall}
			scale={windowBudgetTokens}
			budgetLabel={`窗口安全额度 ${fmtTokens(windowBudgetTokens)} token`}
			verdict={fitsWindow
				? '在额度内'
				: `超出 ${fmtTokens(inputTokensPerCall - windowBudgetTokens)} token`}
		/>

		<ConstraintGauge
			name="月度成本"
			value={fmtCost(monthlyCostUsd)}
			testId="monthly-cost-value"
			ok={withinBudget}
			current={monthlyCostUsd}
			scale={BUDGET.monthlyCostUsd}
			budgetLabel={`预算 ${fmtCost(BUDGET.monthlyCostUsd)}`}
			verdict={withinBudget
				? '在预算内'
				: `超出 ${fmtCost(monthlyCostUsd - BUDGET.monthlyCostUsd)}`}
		/>
	</div>

	<div class="readout">
		<code>
			文档 {SCENARIO.docChars} 字 ÷ {tokenizer.charsPerToken} 字/token ÷ {chunkPlan.chunks} 块 + {SCENARIO.systemPromptTokens}
			(系统提示词) = {fmtTokens(inputTokensPerCall)} token / 次调用
		</code>
		<code>
			{chunkPlan.chunks} 块 × ({fmtTokens(inputTokensPerCall)} in + {SCENARIO.outputTokensPerChunk} out)
			× {SCENARIO.requestsPerMonth} 份/月 = {fmtCost(monthlyCostUsd)}/月
		</code>
	</div>

	<div class="status" role="status">
		{#if solved}
			<p class="status-ok">
				✅ 达标。这个组合既能塞进上下文窗口，月度成本也在预算内。
				<br />
				注意"中文优化词表 + 整篇一次处理"看起来最省 token，却会超窗口—— 分块能救窗口，但每多分一块就要多付一次系统提示词的固定开销，
				分太碎又会把成本推过预算。可行解只在中间地带。
			</p>
		{:else if !fitsWindow && !withinBudget}
			<p class="status-bad">窗口和预算都超了。先想办法把单次调用的 token 数压下来。</p>
		{:else if !fitsWindow}
			<p class="status-bad">
				单次调用超窗口了。试试分更多块——但注意每多一块就要多付一次系统提示词的开销，
				别分过头把成本推超预算。
			</p>
		{:else}
			<p class="status-bad">
				窗口够了，但月度成本超标了。分块太多，系统提示词的固定开销被重复收取的次数太多—— 试试换更省
				token 的分词器，减少分块数。
			</p>
		{/if}
	</div>

	<p class="disclaimer">
		月度成本是精确计算（给定假设单价与场景参数）。分词器的"字符/token 比例"是<b>示意性估算</b>，
		用于体现不同分词器对中文压缩效率的量级差异，不代表某个具体分词器的真实测量值——
		真实比例取决于分词器的训练语料和词表大小。单价均为假设值，非任何厂商真实定价。
	</p>
</section>

<style>
	.sandbox {
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-subtle);
		border-radius: 14px;
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
		color: oklch(0.68 0.01 260);
	}

	.goal {
		margin: 0;
		font-size: 0.9375rem;
		line-height: 1.7;
		padding: 0.75rem 0.875rem;
		background: var(--color-surface-sunken);
		border-left: 2px solid var(--color-accent);
		border-radius: 8px;
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
			grid-template-columns: 1fr 1fr;
		}
	}

	.readout {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface-sunken);
		border-radius: 9px;
	}

	.readout code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		line-height: 1.7;
		color: oklch(0.8 0.01 260);
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
		color: oklch(0.6 0.01 260);
		border-top: 1px solid var(--color-border-subtle);
		padding-top: 0.875rem;
	}
</style>
