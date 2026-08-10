<script lang="ts">
	/**
	 * 站点吉祥物：一个神经元。
	 *
	 * ## 为什么是它，以及为什么它不是装饰
	 *
	 * 它的身体**就是 ReLU 折线**：存活时右半段上扬、输出端亮起；死亡时整条压平、
	 * 输出端熄灭。这正是第一关「反向传播与死亡 ReLU」要教的那件事——
	 * 死亡不是渐变的削弱，是阶跃的截断。所以它在 `BackpropExplorer` 里跟着
	 * `alive2` 走，是内容的一部分，不是贴上去的插画。
	 *
	 * ## 与 AGENTS.md「不要卡通游戏风」的关系
	 *
	 * 那条约束依然有效，本组件是它唯一的、被明确记录的例外（见 AGENTS.md 第 20 条）。
	 * 例外的边界靠三件事守住：
	 *
	 * - **单色**。所有结构线条用 `currentColor`，由调用方通过 `color` 决定，
	 *   所以它天然跟随主题、也不引入第二套配色。
	 * - **默认不动**。没有任何自发动画；状态切换的过渡由调用方的 CSS 决定。
	 * - **面部只有点和短线**。没有渐变、高光、描边描边这类插画语言。
	 *
	 * 眼睛和嘴用 `--color-surface-raised` 而不是白色：胞体填的是 `currentColor`
	 * （通常是强调色），浅色主题下这是白、深色主题下这是深色，两套主题里都与胞体分得开。
	 *
	 * ## 无障碍
	 *
	 * 不传 `label` 时它是纯装饰（导航里紧挨着站名文字），标记为 `aria-hidden`，
	 * 免得读屏在站名前多读一个「图像」。传了 `label` 才成为 `role="img"` 的有名图形——
	 * 在 `BackpropExplorer` 里它承载「已死亡」这个状态，必须能被读出来。
	 */

	type Props = {
		/** 存活状态。死亡时折线压平、输出端熄灭 */
		state?: 'alive' | 'dead';
		/** 渲染高度（px）。宽度按 104:96 的比例走 */
		size?: number;
		/** 传了才对读屏可见；不传则视为装饰 */
		label?: string;
	};

	let { state = 'alive', size = 28, label }: Props = $props();

	const dead = $derived(state === 'dead');
</script>

<svg
	class="mascot"
	class:dead
	viewBox="0 0 104 96"
	height={size}
	width={(size * 104) / 96}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<!-- 树突：上游信号从左侧汇入基线起点。死亡时一并变淡，因为它们不再有下游影响 -->
	<g class="dendrites" stroke="currentColor" stroke-width="3" stroke-linecap="round">
		<path d="M4 64 L15 77" />
		<path d="M2 80 L14 80" />
		<path d="M4 94 L15 83" />
	</g>

	<!--
		身体：ReLU 折线。这两条 d 是唯一区别存活与死亡的几何，
		刻意不用 transform 或 scale —— 阶跃截断不该被表达成「缩放」。

		末端伸进头部内侧、由后画的头覆盖，避免出现接缝。
		第一版把胞体放在拐点正上方，结果胞体把水平段整段盖住，
		存活态读不出「折线」、死亡态看着像个带胡须的禁止标志。
	-->
	<path
		class="body"
		d={dead ? 'M12 80 L80 80' : 'M12 80 L44 80 L78 30'}
		fill="none"
		stroke="currentColor"
		stroke-width="7"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>

	<!--
		头就是输出端。存活时它被抬到折线顶端，死亡时跌回基线——
		「输出被截断」于是同时是几何事实和表情，不需要另加符号去说明。
	-->
	{#if dead}
		<circle cx="82" cy="66" r="14" fill="currentColor" />
		<!-- 闭眼用两条短横线，不用 ✕：✕ 读起来像「错」，而死亡 ReLU 不是答错 -->
		<g stroke="var(--color-surface-raised)" stroke-width="2.8" stroke-linecap="round">
			<path d="M74 63 L80 63" />
			<path d="M84 63 L90 63" />
			<path d="M77 72 L87 72" />
		</g>
	{:else}
		<!-- 光晕只在存活时有：输出被截断之后不该还在发光 -->
		<circle class="halo" cx="82" cy="26" r="19" fill="currentColor" />
		<circle cx="82" cy="26" r="14" fill="currentColor" />
		<circle cx="77" cy="23" r="2.8" fill="var(--color-surface-raised)" />
		<circle cx="87" cy="23" r="2.8" fill="var(--color-surface-raised)" />
		<path
			d="M76 31 Q82 37 88 31"
			fill="none"
			stroke="var(--color-surface-raised)"
			stroke-width="2.8"
			stroke-linecap="round"
		/>
	{/if}
</svg>

<style>
	.mascot {
		display: block;
		flex-shrink: 0;
	}

	.dendrites {
		opacity: 0.5;
	}

	.dead .dendrites {
		opacity: 0.28;
	}

	.halo {
		opacity: 0.22;
	}
</style>
