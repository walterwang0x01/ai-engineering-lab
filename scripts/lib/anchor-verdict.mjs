/**
 * 锚点比对核验 · 共享判定层
 * ─────────────────────────────────────────────────────────────
 * 抽出来是为了让「给结论」和「给材料」两份产物用**同一套判定**：
 *   - scripts/verify-path-questions.mjs → docs/path-question-verification.md（结论）
 *   - scripts/review-pack.mjs           → docs/path-review-pack.md（材料 + 逐题结论）
 * 以前只有前者有判定，人读材料时还得按 id 回前者交叉查一遍；现在并到一起了。
 *
 * 本模块只读：不改题目数据、不翻 reviewed（AGENTS.md 第 17 条）。
 */

import fs from 'node:fs';
import path from 'node:path';

const NOTES = 'static/notes';

// ── 锚点抽取 ──
const RE_BACKTICK = /`([^`]+)`/g;
const RE_BOLD = /\*\*([^*]+?)\*\*/g;
const RE_NUM = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
// 「」引用：语义非对称（见 extractAnchors 注释）——命中算证据，未命中不算问题
const RE_QUOTE = /「([^」]+)」/g;

function isMeaningfulNumber(v) {
	if (/-?\d+\.\d+/.test(v)) return true; // 小数
	if (/[eE][+-]?\d+/.test(v)) return true; // 科学计数
	if (/%$/.test(v)) return true; // 百分比
	const digits = v.replace('-', '').replace(/\.\d+/, '');
	if (digits.length >= 3) return true; // ≥3 位整数（如 400 / 1000）
	return false; // 1~2 位普通整数跳过（噪声）
}

export function extractAnchors(text) {
	const out = [];
	if (!text) return out;
	for (const m of text.matchAll(RE_BACKTICK)) out.push({ type: 'term', value: m[1], raw: m[0] });
	for (const m of text.matchAll(RE_BOLD)) out.push({ type: 'bold', value: m[1], raw: m[0] });
	for (const m of text.matchAll(RE_NUM)) {
		if (isMeaningfulNumber(m[0])) out.push({ type: 'num', value: m[0], raw: m[0] });
	}
	// 「」引用（type: 'quote'）——**语义非对称**，务必按此使用：
	//   命中源笔记 = 这条说法有原文依据（加分证据）
	//   未命中     = 极可能是作者转述，不是编造，**绝不能算「锚点缺失」**
	// 实测：38 道无反引号/加粗的题里，29 道的「」是转述（如「越远越不相关」）。
	// 若把未命中也当缺失，会凭空造出 29 个假「真问题」。
	for (const m of text.matchAll(RE_QUOTE)) {
		if (m[1].length >= 2) out.push({ type: 'quote', value: m[1], raw: m[0] });
	}
	return out;
}

// 归一化：容忍公式写法差异（内存 2026-09-03 踩过的坑：W2(W1x) vs W2·(W1·x+b1)）
const SUP = {
	'²': '^2',
	'³': '^3',
	'¹': '^1',
	'⁰': '^0',
	'⁴': '^4',
	'⁵': '^5',
	'⁶': '^6',
	'⁷': '^7',
	'⁸': '^8',
	'⁹': '^9'
};
const BOLD = {
	'𝟘': '0',
	'𝟙': '1',
	'𝟚': '2',
	'𝟛': '3',
	'𝟜': '4',
	'𝟝': '5',
	'𝟞': '6',
	'𝟟': '7',
	'𝟠': '8',
	'𝟡': '9'
};
export function norm(s) {
	return s
		.replace(/`/g, '') // 去 markdown 反引号（源笔记 `ŷ_c` 带反引号，抽取出的锚点不带）
		.replace(/[‐‑‒–—―−]/g, '-') // 各种连字符 / 减号
		.replace(/[·⋅∗×∘]/g, '') // 乘号直接删（桥接 W·A ↔ WA）
		.replace(/\^\([^)]*\)/g, '') // 上标层号 Z^(l) → Z
		.replace(/_{[^}]*}/g, '') // 下标组 n_{l-1} → n
		.replace(/_[a-z0-9]/g, '') // 单字下标 y_i → y（接受 d_k 也被压成 d 的副作用）
		.replace(/[²³¹⁰⁴⁵⁶⁷⁸⁹]/g, (c) => SUP[c] || c) // 上标数字
		.replace(/[𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡]/gu, (c) => BOLD[c] || c) // 粗体数字（astral 字符，需 u 标志）
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"') // 弯引号 → 直引号
		.replace(/→/g, '->')
		.replace(/≤/g, '<=')
		.replace(/≥/g, '>=')
		.replace(/≠/g, '!=')
		.replace(/\.\.\.|…/g, '') // 占位符 … / ...
		.replace(/[{}]/g, '') // 去花括号 10^{-11} → 10^-11
		.replace(/\s+/g, '') // 去空白
		.replace(/\(\)/g, ''); // 空括号 end() → end
}

/**
 * 从代码表达式里抽「特征 token」：**所有 ≥4 字符的标识符**都要核（数字取 ≥3 位整数）。
 *
 * 为什么是 ≥4 而不是只挑长词：只挑长词会漏掉 `kubectl scale` 里的 `scale`、
 * `onReject: block` 里的 `block`——结果 `kubectl`/`onReject` 在源里出现过就被整体放行，
 * 可源里可能讲的是完全不同的子命令/字段，等于用半个签名蒙混过关。
 * 要求**每一个**标识符都在源里，才是「这个表达式有原文依据」的可靠证据。
 */
function distinctiveTokens(v) {
	const ids = v.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
	const marked = ids.filter((t) => t.length >= 4);
	const nums = v.match(/\d{3,}/g) || [];
	return [...new Set([...marked, ...nums])];
}

/**
 * 代码签名兜底比对。
 * 场景：源笔记给完整调用（含实参），解析里是省略写法（含 `...`），字面比对必然失配，
 * 例如源有 `GuardrailFunctionOutput(output_info=..., tripwire_triggered=False)`，
 * 解析写 `GuardrailFunctionOutput(..., tripwire_triggered=...)`。
 *
 * 三重闸门，缺一不可（逐条都是实测逼出来的）：
 *  1. **不含中文**——中文是事实 claim，允许 token 松散匹配会把「模型在 2024 年发布」
 *     仅因源里有 `2024` 而判为命中，那是假阴性，比误报更危险。
 *  2. **至少一个强特征名**（≥8 字符或含 `_`）——否则 `dict.get` 只因源里有 `dict`、
 *     `str.split` 只因有 `split` 就被放行，等于拿通用词蒙混。
 *  3. **所有 ≥4 字符标识符 / ≥3 位数字全部命中**——避免 `kubectl scale` 只验证
 *     `kubectl` 就放过整个命令（源里可能讲的是别的子命令）。
 */
function codeTokensFound(src, value) {
	if (/[一-鿿]/.test(value)) return false;
	const ids = value.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
	const strong = ids.filter((t) => t.length >= 8 || t.includes('_'));
	if (strong.length === 0) return false; // 闸门 2：没有强特征名就不走这条路
	const ts = distinctiveTokens(value);
	if (ts.length === 0) return false;
	const lower = src.raw.toLowerCase();
	return ts.every((t) => src.raw.includes(t) || lower.includes(t.toLowerCase()));
}

// 锚点是否在源笔记里找得到依据（多策略，容忍压缩/写法差异）
export function anchorFound(src, value) {
	if (src.raw.includes(value)) return true;
	const nv = norm(value);
	if (src.norm.includes(nv)) return true;
	// 方程：解析常把源笔记「推导 = 结论」压缩成只见「结论」，试等号右侧
	if (value.includes('=')) {
		const rhs = value.slice(value.lastIndexOf('=') + 1);
		const nrhs = norm(rhs);
		if (nrhs.length >= 3 && src.norm.includes(nrhs)) return true;
	}
	// 科学计数：1e-11 ↔ 10^-11
	const m = value.match(/^(\d+(?:\.\d+)?)e([+-]?\d+)$/i);
	if (m) {
		const forms = [`10^${m[2]}`, `${m[1]}*10^${m[2]}`];
		if (forms.some((f) => src.norm.includes(norm(f)))) return true;
		// 量级匹配：源里若有一个同指数的具体数（如 6.63e-11），则「1e-11 量级」成立。
		// 此前只认 10^-11 写法，导致把源里正确的 6.63e-11 误判为「无依据」。
		const exp = m[2].replace('+', '\\+');
		const expRe = new RegExp(`[\\d.]+e${exp}(?!\\d)`, 'i');
		if (expRe.test(src.raw) || expRe.test(src.norm)) return true;
	}
	// 引用标记 [1][2]：值里若含带序号中括号，抽出 [n] 序列与源比对，
	// 容忍中间的「内容/…」等说明文字（抽取会把解释性填充一并带进来）。
	const vb = (value.match(/\[\d{1,2}\]/g) || []).join('');
	if (vb) {
		const sb = (src.norm.match(/\[\d{1,2}\]/g) || []).join('');
		if (sb.includes(vb)) return true;
	}
	// 「→0 / ->0」即「接近 0」：中文笔记常用「接近0」表述，归一化后桥接。
	const nv0 = norm(value);
	if (nv0.includes('->0') && src.norm.includes(nv0.replace('->0', '接近0'))) return true;
	// 最后兜底：去所有括号再比一次（容忍 end(...) 里的占位内容）
	const sp = src.norm.replace(/[()]/g, '');
	const vp = norm(value).replace(/[()]/g, '');
	if (sp.includes(vp)) return true;
	// 代码签名兜底：源给完整调用、解析写省略形式时，改按特征 token 逐个核对
	if (codeTokensFound(src, value)) return true;
	return false;
}

// 源笔记（大文件，按 slug 缓存：同一个 slug 下多道题共用）
const sourceCache = new Map();
export function loadSource(slug) {
	if (sourceCache.has(slug)) return sourceCache.get(slug);
	const p = path.join(NOTES, slug + '.md');
	const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
	const entry = { raw, norm: raw ? norm(raw) : null, exists: !!raw };
	sourceCache.set(slug, entry);
	return entry;
}

/**
 * 对一道题下判定。
 * @param anchors 由 extractAnchors 抽出的锚点（解析 + 干扰项说明）
 * @param src     loadSource(slug) 的返回值
 * @returns {kind, reason, missing, found, strictCount, quoteFound, quoteTotal}
 *
 * kind 的语义（保守，不自动翻 reviewed）：
 *   ok       可过审     —— 全部符号/数字锚点在源笔记里有依据
 *   quoteok  倾向可过审 —— 无符号锚点，但「」引用全部命中原文（证据弱于 ok）
 *   noanchor 需人工通读 —— 无可比对锚点（不是发现错误）
 *   mismatch 需修改     —— 有锚点缺失（人判断是写法差异还是事实错误）
 *   delete   建议删除   —— ≥2 个具体 claim 完全找不到，疑似编造（需人确认）
 */
export function judge(anchors, src) {
	if (!src.exists) {
		return {
			kind: 'noanchor',
			reason: '源笔记 markdown 缺失，无法比对（检查同步是否漏了这篇）',
			missing: [],
			found: 0,
			strictCount: anchors.length,
			quoteFound: 0,
			quoteTotal: 0
		};
	}

	// 符号/数字锚点严格判定；「」引用只作加分证据，未命中不计入 missing
	const strict = anchors.filter((a) => a.type !== 'quote');
	const quotes = anchors.filter((a) => a.type === 'quote');
	let quoteFound = 0;
	for (const a of quotes) if (anchorFound(src, a.value)) quoteFound++;

	const missing = [];
	let found = 0;
	for (const a of strict) {
		if (anchorFound(src, a.value)) found++;
		else missing.push({ type: a.type, value: a.value });
	}

	let kind, reason;
	if (strict.length === 0) {
		// 没有符号/数字锚点：只能靠「」引用给证据
		if (quotes.length === 0) {
			kind = 'noanchor';
			reason = '解析无反引号/加粗/数字锚点，锚点法无法自动比对，需人工通读';
		} else if (quoteFound === quotes.length) {
			kind = 'quoteok';
			reason = `无符号锚点，但 ${quotes.length} 处「」引用均在源笔记原文命中，有原文依据（证据强度弱于符号锚点，仍建议通读）`;
		} else if (quoteFound > 0) {
			kind = 'noanchor';
			reason = `无符号锚点；「」引用命中 ${quoteFound}/${quotes.length}（未命中者疑似作者转述），需人工通读`;
		} else {
			kind = 'noanchor';
			reason = `无符号锚点，且 ${quotes.length} 处「」引用均未命中原文（疑似作者转述），需人工通读`;
		}
	} else if (missing.length === 0) {
		kind = 'ok';
		const qNote = quotes.length ? `；另有 ${quoteFound}/${quotes.length} 处「」引用命中原文` : '';
		reason = `全部 ${strict.length} 个符号/数字锚点在源笔记有依据（含归一化比对）${qNote}`;
	} else {
		// 区分缺失项是「公式写法差异」还是「含具体表述的事实 claim」
		const isSoft = (m) =>
			!/[一-鿿]/.test(m.value) && (m.type === 'num' || /[()+\-*/^=.,_√∞≤≥≠→×·]/.test(m.value));
		const soft = missing.filter(isSoft);
		const hard = missing.filter((m) => !isSoft(m));
		const softNote = soft.length
			? `（其中 ${soft.length} 项为符号/公式，疑似写法差异，应可放行）`
			: '';
		if (hard.length === 0) {
			kind = 'mismatch';
			reason = `缺失项均为符号/公式，疑似写法差异，请确认后可放行${softNote}`;
		} else if (hard.length >= 2 && hard.every((m) => m.type === 'num' || /[一-鿿]/.test(m.value))) {
			// 极保守：≥2 个具体量化/中文事实 claim 在源笔记完全找不到，才疑似编造
			kind = 'delete';
			reason = `≥2 个具体 claim 在源笔记找不到：${hard
				.map((m) => m.value)
				.join('、')} —— 疑似编造，建议删除（需你确认）`;
		} else {
			kind = 'mismatch';
			reason = `${missing.length}/${anchors.length} 个锚点缺失，需确认是写法差异还是事实错误；确属编造则删${softNote}`;
		}
	}

	return {
		kind,
		reason,
		missing,
		found,
		strictCount: strict.length,
		quoteFound,
		quoteTotal: quotes.length
	};
}
