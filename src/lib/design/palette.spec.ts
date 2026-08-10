import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 设计系统的配色门禁。
 *
 * ## 存在的理由
 *
 * 收敛之前，全站有 **113 处硬编码的 oklch 字面量散在 17 个文件里**，
 * 其中 L=0.55–0.84 之间挤着 8 个几乎无法分辨的灰
 * （0.60 / 0.62 / 0.64 / 0.66 / 0.68 / 0.70 / 0.72 / 0.74）——历次「凭感觉挑个灰」的产物。
 *
 * 后果有两个，第二个更严重：
 *
 *   1. 换主题（深色转浅色）不是改一个文件，而是在 17 个文件里改 113 处魔法数字，
 *      且没有任何东西能保证你没漏。
 *   2. **有三处灰被用在 11–14px 的小字上、对比度不达标，而没人发现**——
 *      因为没有任何一个地方能一眼看全所有取值。这三处是收敛过程本身暴露出来的。
 *
 * 所以这里守三件事：组件里不许再出现颜色字面量、每个语义色对底色达到 WCAG AA、
 * 相邻灰阶之间的明度差足够大（否则「层级」只是错觉）。
 *
 * 对比度在 Node 里算而不是在浏览器里量：门禁必须能在纯逻辑测试里跑，
 * 不该为了一次颜色断言启动 Chromium。换算用 Björn Ottosson 的 OKLab 矩阵，
 * 结果与浏览器 canvas 实测一致（误差在小数第二位）。
 */

const ROOT = 'src';
const THEME_FILE = 'src/routes/layout.css';
const CSS = readFileSync(THEME_FILE, 'utf8');

/** 递归收集 src 下的样式载体文件 */
function styleFiles(dir = ROOT): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...styleFiles(full));
		else if (/\.(svelte|css)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * 去掉注释再检查颜色字面量。
 *
 * 注释里会**故意**出现历史取值（「序号原来是 oklch(0.42 …)，对比度只有 2.29:1」），
 * 那是这次收敛留下的原因说明，正是应该保留的信息。把注释算进违规会逼人删掉解释，
 * 那就本末倒置了。
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '') // CSS 与 JS 块注释
		.replace(/<!--[\s\S]*?-->/g, '') // Svelte 模板注释
		.replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（避开 https:// 里的双斜杠）
}

/** 从 @theme 里取一个 token 的值 */
function token(name: string): string {
	const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(CSS);
	if (!m) throw new Error(`${THEME_FILE} 里找不到 --${name}`);
	return m[1].trim();
}

/** 取 oklch 的明度分量 */
function lightness(value: string): number {
	const m = /oklch\(([0-9.]+)/.exec(value);
	if (!m) throw new Error(`无法解析明度：${value}`);
	return Number(m[1]);
}

/**
 * oklch(L C H) → WCAG 相对亮度。
 *
 * OKLab → 线性 sRGB 用 Ottosson 的矩阵，然后直接取线性值加权——
 * WCAG 的相对亮度定义在**线性** sRGB 上，所以不需要先编码成 sRGB 再解码回来。
 */
function relativeLuminance(value: string): number {
	const m = /oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/.exec(value);
	if (!m) throw new Error(`无法解析颜色：${value}`);
	const L = Number(m[1]);
	const C = Number(m[2]);
	const h = (Number(m[3]) * Math.PI) / 180;

	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
	const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
	const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);

	return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(fg: string, bg: string): number {
	const a = relativeLuminance(fg);
	const b = relativeLuminance(bg);
	const [hi, lo] = a > b ? [a, b] : [b, a];
	return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

/** 文字层级，从强到弱。顺序即断言相邻间距的依据 */
const TEXT_STEPS = [
	'color-text-strong',
	'color-text',
	'color-text-soft',
	'color-text-muted',
	'color-text-faint'
] as const;

/** 会被用作文字或图标颜色的语义色 */
const SEMANTIC = ['color-accent', 'color-ok', 'color-warn', 'color-bad', 'color-bad-text'] as const;

describe('颜色只能来自 @theme', () => {
	it('layout.css 之外没有任何 oklch 字面量', () => {
		const offenders = styleFiles()
			.filter((f) => f !== THEME_FILE)
			.map((f) => ({
				f,
				n: (stripComments(readFileSync(f, 'utf8')).match(/oklch\(\s*[0-9.]/g) ?? []).length
			}))
			.filter((x) => x.n > 0)
			.map((x) => `${x.f}: ${x.n} 处`);

		expect(
			offenders,
			'颜色字面量必须收敛到 layout.css 的 @theme。' +
				'散在组件里的话，换主题要在多个文件里改魔法数字，而且不达标的取值没人看得见'
		).toEqual([]);
	});

	it('注释里提到历史取值不算违规 —— 那是收敛的原因说明', () => {
		const withComment = `/* 原来是 oklch(0.42 0.02 260)，只有 2.29:1 */\n.a { color: var(--color-text); }`;
		expect(stripComments(withComment).match(/oklch\(\s*[0-9.]/g)).toBeNull();
	});

	it('@theme 里确实定义了这套 token —— 否则上面那条是空转的', () => {
		for (const name of [...TEXT_STEPS, ...SEMANTIC, 'color-surface']) {
			expect(() => token(name), `缺少 --${name}`).not.toThrow();
		}
	});
});

describe('语义色对底色达到 WCAG AA（4.5:1）', () => {
	const surface = token('color-surface');

	for (const name of [...TEXT_STEPS, ...SEMANTIC]) {
		it(`--${name}`, () => {
			const ratio = contrast(token(name), surface);
			expect(
				ratio,
				`--${name} 对 --color-surface 只有 ${ratio}:1。` +
					'小字要求 4.5:1；确实只用于大字时，请在 @theme 的注释里写明契约并把它移出这份清单'
			).toBeGreaterThanOrEqual(4.5);
		});
	}
});

describe('灰阶不许退化成一堆分不清的值', () => {
	it('相邻文字档位之间至少有 0.04 的明度差', () => {
		const ls = TEXT_STEPS.map((n) => lightness(token(n)));
		for (let i = 1; i < ls.length; i++) {
			const gap = Number(Math.abs(ls[i - 1] - ls[i]).toFixed(3));
			expect(
				gap,
				`--${TEXT_STEPS[i - 1]} 与 --${TEXT_STEPS[i]} 只差 ${gap} 明度。` +
					'肉眼分不出来的层级等于没有层级，这正是收敛前 8 个灰并存的状态'
			).toBeGreaterThanOrEqual(0.04);
		}
	});

	it('文字档位按强到弱单调递减', () => {
		const ls = TEXT_STEPS.map((n) => lightness(token(n)));
		expect(ls, '命名顺序必须与实际明度顺序一致，否则 token 名会骗人').toEqual(
			[...ls].sort((a, b) => b - a)
		);
	});
});

describe('换算与浏览器实测一致', () => {
	/**
	 * 这一条守的是换算本身。浏览器 canvas 实测这几个值分别是
	 * 16.86 / 5.55 / 8.52，如果矩阵被改坏，上面所有断言都会静默失真。
	 */
	it('与 canvas 实测值吻合到小数第一位', () => {
		const surface = token('color-surface');
		const cases: [string, number][] = [
			['color-text-strong', 16.86],
			['color-text-faint', 5.55],
			['color-accent', 8.52]
		];
		for (const [name, expected] of cases) {
			const got = contrast(token(name), surface);
			expect(
				Math.abs(got - expected),
				`--${name} 算得 ${got}，浏览器实测 ${expected}`
			).toBeLessThan(0.15);
		}
	});
});
