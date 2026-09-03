/**
 * 路线待审题 · 锚点比对核验
 * ─────────────────────────────────────────────────────────────
 * 目的：帮人把 63 道「路线待审」题快速过一遍。
 * 方法（沿用 2026-09-03 的逐题核对法）：
 *   把每题 解析(explanation) + 干扰项说明(distractorNotes) 里的
 *   「技术锚点」抽出来，回对应的源笔记 markdown 做 indexOf 比对，
 *   看这条说法在原文里能不能找到依据。
 *
 * 锚点类型：
 *   - 反引号术语：`(R/γ)²` `O(N)` `γ` ……  解析里用 `...` 标出的关键符号/公式
 *   - 加粗短语：**...**                    （非贪婪，不跨句）
 *   - 数字：小数 / 科学计数 / ≥3 位整数 / 百分比 / 带量级中文(亿万千百倍)
 *           —— 跳过 1~2 位普通整数，避免「1」「2」满屏噪声
 *
 * 匹配：先原文精确 includes；找不到再「去空白归一化」比一次，
 *       容忍 `(R/γ)²` vs `(R/γ) ^2` 这类写法差异（标 soft）。
 *       两者都找不到才算「缺失」。
 *
 * 分类（保守，不自动翻 reviewed）：
 *   可过审      —— 全部锚点在源笔记里能找到依据
 *   需修改      —— 有锚点缺失（列出具体缺失项，人判断是写法差异还是事实错误）
 *   删除        —— 仅当解析断言的具体量化/事实 claim 多处缺失、疑似编造时
 *                 才标「建议删除（需你确认）」；默认不自动删
 *
 * 不核验：答案选项本身是否正确（那是人读内容的事，锚点法管不了）。
 *
 * 用法：node scripts/verify-path-questions.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'content/note-questions';
const NOTES = 'static/notes';
const OUT = 'docs/path-question-verification.md';

// ── 1. 取路线 slug（复用 review 脚本的正则；取不到就报错，不静默）──
const lp = fs.readFileSync('src/lib/nav/learning-path.ts', 'utf8');
const slugs = [...lp.matchAll(/^\s*slug: '([^']+)',$/gm)].map((m) => m[1]);
if (slugs.length === 0) throw new Error('从 learning-path.ts 没取到 slug，请检查正则。');
const slugSet = new Set(slugs);

// ── 2. 收集路线题库文件 ──
function collect(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(f));
    else if (e.name.endsWith('.json')) out.push(path.relative(ROOT, f).replace(/\.json$/, ''));
  }
  return out;
}
const files = collect(ROOT)
  .filter((s) => slugSet.has(s))
  .sort((a, b) => a.localeCompare(b, 'zh'));

// ── 3. 锚点抽取 ──
const RE_BACKTICK = /`([^`]+)`/g;
const RE_BOLD = /\*\*([^*]+?)\*\*/g;
const RE_NUM = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function isMeaningfulNumber(v) {
  if (/-?\d+\.\d+/.test(v)) return true; // 小数
  if (/[eE][+-]?\d+/.test(v)) return true; // 科学计数
  if (/%$/.test(v)) return true; // 百分比
  const digits = v.replace('-', '').replace(/\.\d+/, '');
  if (digits.length >= 3) return true; // ≥3 位整数（如 400 / 1000）
  return false; // 1~2 位普通整数跳过（噪声）
}

function extractAnchors(text) {
  const out = [];
  if (!text) return out;
  for (const m of text.matchAll(RE_BACKTICK)) out.push({ type: 'term', value: m[1], raw: m[0] });
  for (const m of text.matchAll(RE_BOLD)) out.push({ type: 'bold', value: m[1], raw: m[0] });
  for (const m of text.matchAll(RE_NUM)) {
    if (isMeaningfulNumber(m[0])) out.push({ type: 'num', value: m[0], raw: m[0] });
  }
  return out;
}

// 归一化：容忍公式写法差异（内存 2026-09-03 踩过的坑：W2(W1x) vs W2·(W1·x+b1)）
const SUP = { '²': '^2', '³': '^3', '¹': '^1', '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9' };
const BOLD = { '𝟘': '0', '𝟙': '1', '𝟚': '2', '𝟛': '3', '𝟜': '4', '𝟝': '5', '𝟞': '6', '𝟟': '7', '𝟠': '8', '𝟡': '9' };
function norm(s) {
  return s
    .replace(/`/g, '') // 去 markdown 反引号（源笔记 `ŷ_c` 带反引号，抽取出的锚点不带）
    .replace(/[‐‑‒–—―−]/g, '-') // 各种连字符 / 减号
    .replace(/[·⋅∗×∘]/g, '') // 乘号直接删（桥接 W·A ↔ WA）
    .replace(/\^\([^)]*\)/g, '') // 上标层号 Z^(l) → Z
    .replace(/_{[^}]*}/g, '') // 下标组 n_{l-1} → n
    .replace(/_[a-z0-9]/g, '') // 单字下标 y_i → y（接受 d_k 也被压成 d 的副作用）
    .replace(/[²³¹⁰⁴⁵⁶⁷⁸⁹]/g, (c) => SUP[c] || c) // 上标数字
    .replace(/[𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡]/g, (c) => BOLD[c] || c) // 粗体数字
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

// 锚点是否在源笔记里找得到依据（多策略，容忍压缩/写法差异）
function anchorFound(src, value) {
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
  return false;
}

// ── 4. 逐文件、逐题核验 ──
const rows = []; // {slug, id, prompt, bucket, reason, missing:[{type,value}], anchorsTotal, anchorsFound}
const sourceCache = new Map();

function getSource(slug) {
  if (sourceCache.has(slug)) return sourceCache.get(slug);
  const p = path.join(NOTES, slug + '.md');
  let src = null;
  if (fs.existsSync(p)) src = fs.readFileSync(p, 'utf8');
  const entry = { raw: src, norm: src ? norm(src) : null, exists: !!src };
  sourceCache.set(slug, entry);
  return entry;
}

for (const slug of files) {
  const qpath = path.join(ROOT, slug + '.json');
  if (!fs.existsSync(qpath)) continue;
  const questions = JSON.parse(fs.readFileSync(qpath, 'utf8'));
  const pending = questions.filter((q) => q.reviewed !== true);
  if (pending.length === 0) continue;

  const src = getSource(slug);

  for (const q of pending) {
    const anchors = [
      ...extractAnchors(q.explanation),
      ...Object.values(q.distractorNotes || {}).flatMap(extractAnchors)
    ];

    if (!src.exists) {
      rows.push({
        slug,
        id: q.id,
        prompt: String(q.prompt || '').slice(0, 60),
        kind: 'noanchor',
        reason: '源笔记 markdown 缺失，无法比对（检查同步是否漏了这篇）',
        missing: [],
        anchorsTotal: anchors.length,
        anchorsFound: 0
      });
      continue;
    }

    const missing = [];
    let found = 0;
    for (const a of anchors) {
      if (anchorFound(src, a.value)) found++;
      else missing.push({ type: a.type, value: a.value });
    }

    let kind, reason;
    if (anchors.length === 0) {
      kind = 'noanchor';
      reason = '解析无反引号/加粗锚点，锚点法无法自动比对，需人工通读';
    } else if (missing.length === 0) {
      kind = 'ok';
      reason = `全部 ${anchors.length} 个锚点在源笔记有依据（含归一化比对）`;
    } else {
      // 区分缺失项是「公式写法差异」还是「含具体表述的事实 claim」
      const isSoft = (m) =>
        !/[一-鿿]/.test(m.value) && (m.type === 'num' || /[()+\-*/^=.,_√∞≤≥≠→×·]/.test(m.value));
      const soft = missing.filter(isSoft);
      const hard = missing.filter((m) => !isSoft(m));
      const softNote = soft.length ? `（其中 ${soft.length} 项为符号/公式，疑似写法差异，应可放行）` : '';
      if (hard.length === 0) {
        kind = 'mismatch';
        reason = `缺失项均为符号/公式，疑似写法差异，请确认后可放行${softNote}`;
      } else if (hard.length >= 2 && hard.every((m) => m.type === 'num' || /[一-鿿]/.test(m.value))) {
        // 极保守：≥2 个具体量化/中文事实 claim 在源笔记完全找不到，才疑似编造
        kind = 'delete';
        reason = `≥2 个具体 claim 在源笔记找不到：${hard.map((m) => m.value).join('、')} —— 疑似编造，建议删除（需你确认）`;
      } else {
        kind = 'mismatch';
        reason = `${missing.length}/${anchors.length} 个锚点缺失，需确认是写法差异还是事实错误；确属编造则删${softNote}`;
      }
    }

    rows.push({
      slug,
      id: q.id,
      prompt: String(q.prompt || '').slice(0, 60),
      kind,
      reason,
      missing,
      anchorsTotal: anchors.length,
      anchorsFound: found
    });
  }
}

// ── 5. 汇总（按 kind 分组）──
const groups = {
  ok: rows.filter((r) => r.kind === 'ok'),
  需修改: rows.filter((r) => r.kind === 'mismatch'),
  无锚点: rows.filter((r) => r.kind === 'noanchor'),
  删除: rows.filter((r) => r.kind === 'delete')
};

// ── 6. 写报告 ──
const lines = [];
lines.push('# 路线待审题 · 锚点比对核验报告');
lines.push('');
lines.push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
lines.push('> 方法：解析+干扰项说明里的反引号术语/加粗短语/数字 → 回源笔记 markdown 做 indexOf 比对（含激进归一化：去 markdown 反引号、上下标、占位符、空括号、写法差异；引用标记 `[n]` 序列比对；`→0`↔`接近0`；科学计数 `1e-11` 量级匹配源里 `6.63e-11` 等同指数项）。');
lines.push('> 本脚本只做「依据核查」，**不改任何文件、不翻 reviewed**。结论供你人工过审时参考。');
lines.push('> 答案选项本身是否正确不在自动核验范围内，仍需你通读。');
lines.push('');
lines.push('## 汇总');
lines.push('');
lines.push(`- 路线待审总数：**${rows.length}** 道`);
lines.push(`- ✅ 可过审（锚点全中）：${groups.ok.length}`);
lines.push(`- 🟡 需修改·锚点缺失（真问题）：${groups.需修改.length}`);
lines.push(`- 🟡 需人工通读·无锚点可验：${groups.无锚点.length}`);
lines.push(`- 🔴 建议删除（待确认）：${groups.删除.length}`);
lines.push('');
lines.push('> 说明：「无锚点可验」不是发现错误，而是这些解析没有反引号/加粗标记、锚点法无从比对，必须人工通读后才能翻 reviewed。');
lines.push('> 若想让这部分未来也能自动核验，可在解析里给关键符号加反引号（如 `d_k`）。');
lines.push('');
lines.push('## 逐题明细');
lines.push('');

const sections = [
  { key: 'ok', icon: '✅', title: `可过审（锚点全中，${groups.ok.length}）` },
  { key: '需修改', icon: '🟡', title: `需修改·锚点缺失（真问题，${groups.需修改.length}）` },
  { key: '无锚点', icon: '🟡', title: `需人工通读·无锚点可验（${groups.无锚点.length}）` },
  { key: '删除', icon: '🔴', title: `建议删除（待确认，${groups.删除.length}）` }
];
for (const sec of sections) {
  const list = groups[sec.key];
  if (list.length === 0) continue;
  lines.push(`### ${sec.icon} ${sec.title}`);
  lines.push('');
  // 按 slug 分组
  const bySlug = {};
  for (const r of list) (bySlug[r.slug] ||= []).push(r);
  for (const [slug, rs] of Object.entries(bySlug)) {
    lines.push(`**${slug}**`);
    for (const r of rs) {
      lines.push(`- \`${r.id}\` — ${r.prompt}…`);
      lines.push(`  - 结论：${r.reason}`);
      if (r.missing.length) {
        lines.push(`  - 缺失锚点：${r.missing.map((m) => `\`${m.value}\`(${m.type})`).join('、')}`);
      }
    }
    lines.push('');
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

// ── 7. 控制台摘要 ──
console.log(`路线待审：${rows.length} 道`);
console.log(`  可过审（锚点全中）   : ${groups.ok.length}`);
console.log(`  需修改·锚点缺失      : ${groups.需修改.length}`);
console.log(`  需人工通读·无锚点    : ${groups.无锚点.length}`);
console.log(`  建议删除（待确认）   : ${groups.删除.length}`);
console.log(`\n报告已写入 ${OUT}`);
if (groups.删除.length) {
  console.log('\n🔴 建议删除的题（需你确认）：');
  for (const r of groups.删除) console.log(`  - ${r.slug} / ${r.id}`);
}
