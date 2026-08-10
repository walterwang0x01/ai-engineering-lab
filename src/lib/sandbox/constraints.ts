/**
 * 达标型沙盒的共享纯逻辑。
 *
 * ## 为什么现在抽，之前不抽
 *
 * `levels/types.ts` 里写着「交互组件作为组件传入，不抽象」——那个判断是在只有
 * **两个样本**、且两者分属不同类别时下的：KV Cache 是达标型（双约束调参），
 * Attention 是观察型（只看不判定）。把两类压成一个声明式 DSL 会得到一个
 * 既复杂又不够用的东西，那个结论至今成立。
 *
 * 但现在有五个样本，其中**三个是同一类**：KvCache / TokenizerCost / RagChunking
 * 都是「离散选项组 → 派生指标 → K 个阈值比较 → 全部满足即达标」。
 * 三份实现的仪表盘 CSS 逐条比对后**完全相同**（24 条规则重复了三遍）。
 *
 * 所以这里抽的不是通用 DSL，是达标型这**一个具体形状**里可证明重复的部分：
 * 进度条百分比、达标合并、首次达标闩锁。公式、阈值、文案仍留在各自的沙盒里，
 * 观察型的 AttentionHeatmap 和 BackpropExplorer 完全不受影响。
 */

/**
 * 指标相对预算的进度条百分比。
 *
 * 夹在 0..100：超预算时进度条只是填满，不会溢出容器。
 * 越界后的具体倍数由 verdict 文案负责表达（「超出 275 GB」比一条 600% 的条更有信息量）。
 *
 * @param value 当前指标值
 * @param budget 预算/阈值。为 0 或负数时返回 0，避免除零得出 Infinity
 */
export function barPct(value: number, budget: number): number {
	if (!Number.isFinite(value) || !Number.isFinite(budget) || budget <= 0) return 0;
	return Math.max(0, Math.min(100, (value / budget) * 100));
}

/**
 * 全部约束满足才算达标。
 *
 * 空数组返回 false 而不是 true：`[].every()` 为真是数学上的约定，
 * 但对沙盒来说「一个约束都没有」意味着配置写错了，判成达标会掩盖问题。
 */
export function allSatisfied(flags: readonly boolean[]): boolean {
	return flags.length > 0 && flags.every(Boolean);
}

/**
 * 首次达标闩锁：达标过就一直记着，之后再调坏也不清除。
 *
 * 用途是「你已经找到过一个可行解」这类提示——它记录的是学习事件的发生，
 * 不是当前状态，所以不能跟着 solved 一起回落。
 *
 * 写成类而不是 rune，是为了留在纯 .ts 里可被 Node 单测直接覆盖；
 * 调用方在组件里用 `$state` 包一层即可。
 */
export class SolvedLatch {
	#latched = false;

	/** 喂入当前达标状态，返回闩锁是否**在这次调用中**被点亮 */
	observe(solved: boolean): boolean {
		if (solved && !this.#latched) {
			this.#latched = true;
			return true;
		}
		return false;
	}

	get latched(): boolean {
		return this.#latched;
	}
}
