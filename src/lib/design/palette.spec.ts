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
 *   1. 换主题不是改一个文件，而是在 17 个文件里改 113 处魔法数字，
 *      且没有任何东西能保证你没漏。
 *   2. **有三处灰被用在 11–14px 的小字上、对比度不达标，而没人发现**——
 *      因为没有任何一个地方能一眼看全所有取值。
 *
 * 支持两套主题之后，第一条的风险变成了新的形式：**漏覆盖**。深色块里少写一个
 * token，那一项就留着浅色取值——text-strong 会变成近黑压在深色底上，直接看不见。
 * 所以这里除了对比度，还校验覆盖的完整性。
 *
 * 对比度在 Node 里算而不是在浏览器里量：门禁必须能在纯逻辑测试里跑，
 * 不该为了一次颜色断言启动 Chromium。换算用 Björn Ottosson 的 OKLab 矩阵，
 * 结果与浏览器 canvas 实测一致（见文件末尾那条钉子）。
 */

const ROOT = 'src';
const THEME_FILE = 'src/routes/layout.css';
const CSS = readFileSync(THEME_FILE, 'utf8');

type Rgb = { L: number; C: number; H: number };

/** 递归收集 src 下可能出现颜色的文件 */
function sourceFiles(dir = ROOT): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (/\.(svelte|css|ts)$/.test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * 去掉注释再检查颜色字面量。
 *
 * 注释里会**故意**出现历史取值（「原为 0.45，对底色只有 2.78:1」），那是取值背后的
 * 原因说明，正是应该保留的信息。把注释算进违规会逼人删掉解释，本末倒置。
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '') // CSS 与 JS 块注释
		.replace(/<!--[\s\S]*?-->/g, '') // Svelte 模板注释
		.replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行注释（避开 https:// 里的双斜杠）
}

/**
 * 数出一段源码里的颜色字面量。
 *
 * 两种形式都要数：
 * - `oklch(0.32 0.04 200)` —— CSS 里直接写死。
 * - `` `oklch(${x} ${y} 200)` `` —— JS 里拼出来。热力图的色阶曾经就是这么写的，
 *   而只匹配「oklch( 后面紧跟数字」的正则**正好躲过去**，让它在门禁下藏了一整轮。
 */
function countColorLiterals(source: string): number {
	const clean = stripComments(source);
	const css = clean.match(/oklch\(\s*[0-9.]/g) ?? [];
	const interpolated = clean.match(/['"`][^'"`]*oklch\(\s*\$\{/g) ?? [];
	return css.length + interpolated.length;
}

/** 把一段 `--name: value;` 的文本解析成 token 表 */
function parseTokens(block: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const m of block.matchAll(/--(color-[\w-]+):\s*([^;]+);/g)) {
		map.set(m[1], m[2].trim());
	}
	return map;
}

/** 取出 `@theme { … }` 的内容 —— 即浅色（默认）主题 */
function themeBlock(): string {
	const start = CSS.indexOf('@theme {');
	if (start < 0) throw new Error('layout.css 里找不到 @theme 块');
	return CSS.slice(start, CSS.indexOf('\n}', start));
}

/** 取出 `prefers-color-scheme: dark` 里那层 `:root` 的内容 */
function darkBlock(): string {
	const m = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n\t\t\}/.exec(CSS);
	if (!m) throw new Error('layout.css 里找不到 prefers-color-scheme: dark 的 :root 块');
	return m[1];
}

const LIGHT_TOKENS = parseTokens(themeBlock());
const DARK_OVERRIDES = parseTokens(darkBlock());

/** 深色主题的完整取值 = 浅色打底 + 深色覆盖 */
const DARK_TOKENS = new Map([...LIGHT_TOKENS, ...DARK_OVERRIDES]);

const THEMES = [
	{ name: '浅色（@theme 默认）', tokens: LIGHT_TOKENS },
	{ name: '深色（prefers-color-scheme: dark）', tokens: DARK_TOKENS }
] as const;

function parse(value: string): Rgb {
	const m = /oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/.exec(value);
	if (!m) throw new Error(`无法解析颜色：${value}`);
	return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

/**
 * oklch → WCAG 相对亮度。
 *
 * OKLab → 线性 sRGB 用 Ottosson 的矩阵，然后直接加权——WCAG 的相对亮度定义在
 * **线性** sRGB 上，所以不需要先编码成 sRGB 再解码回来。
 */
function relativeLuminance(value: string): number {
	const { L, C, H } = parse(value);
	const h = (H * Math.PI) / 180;
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

/** 文字层级，从强到弱。顺序即断言的依据 */
const TEXT_STEPS = [
	'color-text-strong',
	'color-text',
	'color-text-soft',
	'color-text-muted',
	'color-text-faint'
] as const;

/** 会被用作文字或图标颜色的语义色 */
const SEMANTIC = ['color-accent', 'color-ok', 'color-warn', 'color-bad', 'color-bad-text'] as const;

/**
 * **所有会承载文字的面层**，不只是 `--color-surface`。
 *
 * 这份清单是补出来的，因为原来只校验对 `--color-surface` 的对比度，
 * 而文字实际还压在卡片（raised）、统计卡与状态条（sunken）、代码块（code）、
 * hover 层（overlay）上。浅色主题里 sunken 是浅灰卡片底，muted 小字压上去
 * 只有 4.42:1 —— 差 0.08 不达标，而门禁看的是它对 surface 的 6.0:1，全程绿灯。
 *
 * 教训：一个 token 的对比度不是它自己的属性，是它与**每一个可能的底色**配对的属性。
 */
const TEXT_SURFACES = [
	'color-surface',
	'color-surface-raised',
	'color-surface-sunken',
	'color-surface-inset',
	'color-surface-overlay'
] as const;

/**
 * 非文字但承载必要信息的 token，按 WCAG 1.4.11 要求 3:1。
 *
 * - `accent-dim`：hover / 选中态的边框，是状态指示。
 * - `border-strong`：边框是该控件唯一的视觉边界时用它（搜索框、答题框、幽灵按钮）。
 * - `track`：进度轨道。新用户所有进度都是 0，轨道是那一刻唯一可见的部分。
 *
 * `border-subtle` **刻意不在此列**：它只做装饰性分隔，容器本身有底色差异可辨。
 * 但这个豁免曾经被滥用——幽灵按钮和输入框也在用它，而那些地方边框是唯一的
 * 可供性信号，浅色下 1.6:1 让它们退化成纯文本。所以拆出了 border-strong。
 */
const NON_TEXT = ['color-accent-dim', 'color-border-strong', 'color-track'] as const;

/**
 * 语法高亮的五档。
 *
 * 它们只出现在 `<pre>` 里，而 `<pre>` 的底色是 `--color-surface-sunken`，
 * 所以只对那一个面层校验——把它们塞进 TEXT_SURFACES 的全量交叉检查会得出
 * 一堆永远不会发生的配对，然后逼着取值去满足不存在的约束。
 *
 * 门槛取 5:1 而不是 4.5:1：代码是等宽小字，而且要长时间扫读。
 *
 * **取值要留余量，不要正好压在门槛上。** 这里的 OKLab 矩阵与 Chromium 的实现
 * 有约 0.01–0.02 的差，第一版把四个取值解到恰好 5.00，本地全绿而浏览器实测
 * 是 4.99 —— 门禁通过了，真实渲染却不达标。现在解到 5.25。
 */
const CODE_TOKENS = [
	'color-code-keyword',
	'color-code-string',
	'color-code-number',
	'color-code-fn',
	'color-code-comment'
] as const;

/**
 * 刻意在两套主题里保持一致的 token，不参与「深色必须覆盖」的完整性校验。
 * 每一项都必须有理由——热力图是有自己画布的数据可视化，见 layout.css 里的说明。
 */
const THEME_INVARIANT = new Set([
	'color-heat-lo',
	'color-heat-hi',
	'color-heat-canvas',
	'color-heat-mask-a',
	'color-heat-mask-b',
	'color-on-heat',
	'color-on-heat-dark',
	'color-on-heat-outline'
]);

describe('颜色只能来自 @theme', () => {
	it('layout.css 之外没有任何颜色字面量', () => {
		const offenders = sourceFiles()
			.filter((f) => f !== THEME_FILE)
			// 排除自己：下面几条自测用例里故意放着样例字面量，用来证明这条规则真的会命中。
			// 不排除的话，门禁会因为「守规则的证据」而失败。
			.filter((f) => f !== 'src/lib/design/palette.spec.ts')
			.map((f) => ({ f, n: countColorLiterals(readFileSync(f, 'utf8')) }))
			.filter((x) => x.n > 0)
			.map((x) => `${x.f}: ${x.n} 处`);

		expect(
			offenders,
			'颜色字面量必须收敛到 layout.css。散在组件里的话，换主题要在多个文件里改' +
				'魔法数字，而且不达标的取值没人看得见'
		).toEqual([]);
	});

	it('模板字符串里拼出来的颜色也算违规', () => {
		// 热力图的色阶曾经是这么写的，只匹配「oklch( 后跟数字」的正则抓不到
		expect(countColorLiterals('return `oklch(${0.32 + t} ${0.04} 200)`;')).toBe(1);
	});

	it('注释里提到历史取值不算违规 —— 那是取值的原因说明', () => {
		expect(countColorLiterals('/* 原为 oklch(0.45 0.09 200)，只有 2.78:1 */')).toBe(0);
	});
});

describe('两套主题都定义完整', () => {
	it('浅色定义了全部必需 token', () => {
		for (const name of [...TEXT_STEPS, ...SEMANTIC, 'color-surface']) {
			expect(LIGHT_TOKENS.has(name), `@theme 里缺少 --${name}`).toBe(true);
		}
	});

	it('深色覆盖了每一个与主题相关的 token', () => {
		const missing = [...LIGHT_TOKENS.keys()]
			.filter((k) => !THEME_INVARIANT.has(k))
			.filter((k) => !DARK_OVERRIDES.has(k));

		expect(
			missing,
			'漏覆盖的 token 会留着浅色取值。比如 --color-text-strong 漏了，' +
				'深色主题下就是近黑压在深色底上——不是「不好看」，是看不见。' +
				'确实应当两套一致的请加进 THEME_INVARIANT 并写明理由'
		).toEqual([]);
	});

	it('深色没有覆盖多余的 token', () => {
		const extra = [...DARK_OVERRIDES.keys()].filter((k) => !LIGHT_TOKENS.has(k));
		expect(extra, '深色块里的 token 在 @theme 里不存在，八成是拼错了或已被删除').toEqual([]);
	});
});

describe.each(THEMES)('$name', ({ tokens }) => {
	/** 该主题下最难承载文字的面层（浅色里最暗、深色里最亮的那个） */
	function hardestSurface(fg: string): { name: string; ratio: number } {
		let worst = { name: '', ratio: Infinity };
		for (const s of TEXT_SURFACES) {
			const ratio = contrast(fg, tokens.get(s)!);
			if (ratio < worst.ratio) worst = { name: s, ratio };
		}
		return worst;
	}

	describe('文字与语义色对每一个承载它的面层都达到 AA（4.5:1）', () => {
		for (const name of [...TEXT_STEPS, ...SEMANTIC]) {
			it(`--${name}`, () => {
				const worst = hardestSurface(tokens.get(name)!);
				expect(
					worst.ratio,
					`--${name} 压在 --${worst.name} 上只有 ${worst.ratio}:1。一个 token 的对比度` +
						'不是它自己的属性，是它与每一个可能底色配对的属性——只校验 --color-surface ' +
						'就是 muted 小字 4.42:1 那次漏检的原因'
				).toBeGreaterThanOrEqual(4.5);
			});
		}
	});

	describe('非文字对比（WCAG 1.4.11，3:1）', () => {
		for (const name of NON_TEXT) {
			it(`--${name}`, () => {
				const worst = hardestSurface(tokens.get(name)!);
				expect(
					worst.ratio,
					`--${name} 压在 --${worst.name} 上只有 ${worst.ratio}:1，作为必要的视觉指示需要 3:1`
				).toBeGreaterThanOrEqual(3);
			});
		}
	});

	describe('语法高亮五档对代码块底色达到 5:1', () => {
		for (const name of CODE_TOKENS) {
			it(`--${name}`, () => {
				const ratio = contrast(tokens.get(name)!, tokens.get('color-surface-sunken')!);
				expect(
					ratio,
					`--${name} 压在 --color-surface-sunken 上只有 ${ratio}:1。` +
						'代码是等宽小字且要长时间扫读，所以门槛比正文的 4.5 更高'
				).toBeGreaterThanOrEqual(5);
			});
		}

		/**
		 * 五档必须互相可辨。全部达标但彼此雷同的话，高亮就没有传递任何结构信息——
		 * 而这正是它存在的唯一理由。
		 */
		it('五档之间两两可辨', () => {
			/*
			 * 三个维度任一项拉开即算可辨，**饱和度也算**。
			 *
			 * 第一版只看色相和明度，于是把 code-fn（饱和蓝 C=0.15）和 code-comment
			 * （近灰 C=0.012）判成「太接近」——它们色相差 14°、明度差 0.015，
			 * 但一个是蓝一个是灰，肉眼一眼分得开。判据漏了那一维，不是取值有问题。
			 *
			 * 色相差只在两者都有可观饱和度时才算得上区分手段：两个近灰之间，
			 * 色相是没有意义的（C→0 时色相不影响观感）。
			 */
			const vals = CODE_TOKENS.map((n) => ({ n, ...parse(tokens.get(n)!) }));
			for (let i = 0; i < vals.length; i++) {
				for (let j = i + 1; j < vals.length; j++) {
					const a = vals[i];
					const b = vals[j];
					const dh = Math.min(Math.abs(a.H - b.H), 360 - Math.abs(a.H - b.H));
					const bothSaturated = a.C > 0.05 && b.C > 0.05;
					const distinguishable =
						(bothSaturated && dh > 25) || Math.abs(a.L - b.L) > 0.08 || Math.abs(a.C - b.C) > 0.06;
					expect(
						distinguishable,
						`--${a.n} 与 --${b.n} 太接近：色相差 ${dh.toFixed(0)}°、` +
							`明度差 ${Math.abs(a.L - b.L).toFixed(3)}、饱和差 ${Math.abs(a.C - b.C).toFixed(3)}。` +
							'五档全部达标但彼此雷同的话，高亮没有传递任何结构信息'
					).toBe(true);
				}
			}
		});
	});

	describe('强调色填充上的文字', () => {
		/**
		 * 主按钮是实心 accent 底 + on-accent 文字。这一对不在 TEXT_SURFACES 的
		 * 交叉检查里（accent 不是面层），漏掉它就意味着最显眼的那个按钮没人校验。
		 */
		it('--color-on-accent 对 --color-accent', () => {
			const ratio = contrast(tokens.get('color-on-accent')!, tokens.get('color-accent')!);
			expect(ratio, `主按钮标签只有 ${ratio}:1`).toBeGreaterThanOrEqual(4.5);
		});
	});

	describe('禁用态仍要能读出标签', () => {
		/**
		 * WCAG 对禁用控件豁免对比度，但用户仍需读出按钮上写的是「提交」还是「下一题」
		 * 才知道下一步该干什么。这一条同时守着「不要用 opacity 表达禁用」——
		 * opacity 把元素往背景色拉，浅色下浅文字与浅底一起变淡，差值被压掉。
		 */
		it('--color-disabled-text 对 --color-disabled-surface', () => {
			const ratio = contrast(
				tokens.get('color-disabled-text')!,
				tokens.get('color-disabled-surface')!
			);
			expect(ratio, `禁用态标签只有 ${ratio}:1，用户读不出按钮上写的是什么`).toBeGreaterThanOrEqual(
				4.5
			);
		});
	});

	describe('灰阶不许退化成一堆分不清的值', () => {
		it('相邻文字档位之间至少有 0.04 的明度差', () => {
			const ls = TEXT_STEPS.map((n) => parse(tokens.get(n)!).L);
			for (let i = 1; i < ls.length; i++) {
				const gap = Number(Math.abs(ls[i - 1] - ls[i]).toFixed(3));
				expect(
					gap,
					`--${TEXT_STEPS[i - 1]} 与 --${TEXT_STEPS[i]} 只差 ${gap} 明度。` +
						'肉眼分不出来的层级等于没有层级，这正是收敛前 8 个灰并存的状态'
				).toBeGreaterThanOrEqual(0.04);
			}
		});

		/**
		 * 断言的是**对比度**递减，不是明度递减。
		 *
		 * 明度递减这条规则只在深色主题下成立：浅色主题里 strong 是最深的，
		 * 明度反而最低。「越强 = 对底色反差越大」才是与主题无关的那个不变量。
		 */
		it('从 strong 到 faint，对底色的对比度单调递减', () => {
			const ratios = TEXT_STEPS.map((n) => contrast(tokens.get(n)!, tokens.get('color-surface')!));
			for (let i = 1; i < ratios.length; i++) {
				expect(
					ratios[i],
					`--${TEXT_STEPS[i]} 的对比度 ${ratios[i]} 不低于 --${TEXT_STEPS[i - 1]} 的 ` +
						`${ratios[i - 1]}。命名顺序必须与实际强弱一致，否则 token 名会骗人`
				).toBeLessThan(ratios[i - 1]);
			}
		});
	});
});

/**
 * oklch → `#rrggbb`。
 *
 * 只为一件事存在：校验那些**拿不到 CSS token、只能手抄取值**的独立文档。
 * 目前只有 favicon（`static/favicon.svg`）。
 *
 * 手抄副本会漂移，而且是静默漂移：`scripts/generate-og.mjs` 里那份注释写着
 * 「与 layout.css 保持一致」的硬编码色板，在 token 收敛后过期了整整一轮，
 * 分享出去的预览图与实际页面是两套配色，没有任何东西报警。
 * OG 脚本已改成直接解析 layout.css，favicon 改不了（SVG 里没法 var()），所以钉在这里。
 */
function oklchToHex(value: string): string {
	const { L, C, H } = parse(value);
	const h = (H * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

	const enc = (v: number) => {
		const c = Math.min(1, Math.max(0, v));
		const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
		return Math.round(srgb * 255)
			.toString(16)
			.padStart(2, '0');
	};

	return (
		'#' +
		enc(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s) +
		enc(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s) +
		enc(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s)
	);
}

describe('拿不到 token 的独立文档不许漂移', () => {
	it('favicon 的底色等于 @theme 的 --color-accent', () => {
		const svg = readFileSync('static/favicon.svg', 'utf8');
		const fill = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1]?.toLowerCase();
		const expected = oklchToHex(LIGHT_TOKENS.get('color-accent')!);
		expect(
			fill,
			`favicon 底色是 ${fill}，而 --color-accent 现在是 ${expected}。` +
				'favicon 是独立文档、只能手抄取值，所以改 accent 时必须同步改它'
		).toBe(expected);
	});
});

describe('换算与浏览器实测一致', () => {
	/**
	 * 这一条守的是换算本身。深色主题这三个值在浏览器 canvas 里实测分别是
	 * 16.86 / 5.55 / 8.52，如果矩阵被改坏，上面所有断言都会静默失真。
	 */
	it('与 canvas 实测值吻合到小数第一位', () => {
		const surface = DARK_TOKENS.get('color-surface')!;
		const cases: [string, number][] = [
			['color-text-strong', 16.86],
			['color-text-faint', 5.55],
			['color-accent', 8.52]
		];
		for (const [name, expected] of cases) {
			const got = contrast(DARK_TOKENS.get(name)!, surface);
			expect(
				Math.abs(got - expected),
				`--${name} 算得 ${got}，浏览器实测 ${expected}`
			).toBeLessThan(0.15);
		}
	});
});
