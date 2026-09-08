/**
 * 路线待审题 · 过审包
 * ─────────────────────────────────────────────────────────────
 * 目的：把「人读一遍」这一步的成本压下来。
 *   AGENTS.md 第 17 条要求 reviewed 必须人工翻，63 道都得人读。
 *   读题时最费时间的是「去源笔记里找对应的段落」——本脚本替你找。
 *
 * 做法：对每道待审题，从题干+选项+解析里抽**特征**（英文术语、数字、反引号术语、
 *   「」引用，以及中文二元词组），去源笔记分段打分，取最相关的 1~2 段原文贴在题目下面。
 *   打分带 IDF：笔记里到处都有的词（Attention、softmax）区分度低，自然降权。
 *   第二段还要求达到首段得分的一半，否则宁缺毋滥——塞一段不相干的原文比不给更糟。
 *
 * 与 verify-path-questions.mjs 的分工：
 *   那个给「结论」（锚点是否命中、该进哪个桶），这个给「材料」（原文段落）。
 *   两者都不改题目数据、都不翻 reviewed。
 *
 * 用法：npm run notes:review-pack
 */

import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';
import { extractAnchors, judge, loadSource } from './lib/anchor-verdict.mjs';

const ROOT = 'content/note-questions';
const NOTES = 'static/notes';
const OUT = 'docs/path-review-pack.md';
const MAX_EXCERPT = 700; // 每段原文最长字符数
const TOP_N = 2; // 每题最多取几段
const MIN_RATIO = 0.5; // 第二段至少要达到首段得分的这个比例，否则宁缺毋滥

// ── 1. 取路线 slug（与 verify 脚本一致）──
const lp = fs.readFileSync('src/lib/nav/learning-path.ts', 'utf8');
const slugs = [...lp.matchAll(/^\s*slug: '([^']+)',$/gm)].map((m) => m[1]);
if (slugs.length === 0) throw new Error('从 learning-path.ts 没取到 slug，请检查正则。');
const slugSet = new Set(slugs);

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

// ── 2. 特征词：英文术语 / 数字 / 反引号术语 / 「」引用 ──
const STOP = new Set([
	'the',
	'and',
	'for',
	'with',
	'that',
	'this',
	'from',
	'into',
	'than',
	'then',
	'when',
	'what',
	'which',
	'would',
	'could',
	'not',
	'but',
	'are',
	'was',
	'has',
	'have',
	'its',
	'it',
	'as',
	'at',
	'by',
	'on',
	'of',
	'to',
	'in',
	'is',
	'be',
	'or',
	'if',
	'a',
	'an'
]);

function keywords(text) {
	const kws = new Map(); // kw -> 权重
	const add = (k, w) => {
		if (!k || k.length < 2) return;
		if (STOP.has(k.toLowerCase())) return;
		const cur = kws.get(k) || 0;
		kws.set(k, Math.max(cur, w));
	};
	// 英文/符号术语（ML 笔记里区分度最高）
	for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_.^-]{2,}/g)) {
		add(m[0].replace(/[.]+$/, ''), m[0].length >= 5 ? 3 : 2);
	}
	// 数字（≥2 位）
	for (const m of text.matchAll(/\d{2,}(?:\.\d+)?/g)) add(m[0], 2);
	// 反引号术语与「」引用：作者亲手标出的关键说法，权重最高
	for (const m of text.matchAll(/`([^`]+)`/g)) add(m[1], 4);
	for (const m of text.matchAll(/「([^」]+)」/g)) add(m[1], 4);
	// 中文二元词组，权重 1（靠 IDF 而不是靠权重拉开差距）
	for (const g of cjkGrams(text)) add(g, 1);
	return [...kws.entries()];
}

// 中文二元词组：笔记正文以中文为主，光靠英文术语区分度不够
// （一道题常常只抽出 2~3 个英文词，随便哪节都能撞上一个）。
// 滑窗取 2 字，配合下面的 IDF，专有说法（外推 / 先验 / 偏置）自然浮上来。
const CJK = '\\u4e00-\\u9fff';
function cjkGrams(text) {
	const chars = [...text].filter((ch) => new RegExp(`^[${CJK}]$`).test(ch));
	const out = new Set();
	for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
	return [...out];
}

// ── 3. 源笔记分段与打分 ──
const countFences = (s) => (s.match(/^```/gm) || []).length;

function splitChunks(src) {
	// 先按标题切，再按空行切，保留标题作为该段上下文。
	// 顺带记录每段「开始时是否已经在一个 ``` 代码块里」：
	// 代码内部的空行会把一个代码块切成好几段，围栏留在前一段里，
	// 只看单段永远数不对奇偶——必须按整篇顺序跟踪。
	const out = [];
	let inCode = false;
	for (const block of src.split(/\n(?=## )/)) {
		const heading = block.startsWith('## ') ? block.split('\n')[0] : '';
		for (const p of block.split(/\n\s*\n/)) {
			const t = p.trim();
			if (!t) continue;
			out.push({ heading, text: t, inCode });
			if (countFences(t) % 2 === 1) inCode = !inCode;
		}
	}
	return out;
}

function pickChunks(src, kws) {
	const chunks = splitChunks(src);

	// IDF：在笔记里「到处都有」的词（Attention / softmax / d_k …）区分度低，降权；
	// 只在少数几节出现的词（ALiBi、RoPE …）才是真正的定位信号，升权。
	// 不做这一步的话，通用词会把不相关的长段落顶到高分位。
	const df = new Map();
	for (const c of chunks) {
		for (const [k] of kws) if (c.text.includes(k)) df.set(k, (df.get(k) || 0) + 1);
	}
	const N = Math.max(1, chunks.length);

	const scored = [];
	for (let i = 0; i < chunks.length; i++) {
		const c = chunks[i];
		let score = 0;
		let firstHit = -1;
		for (const [k, w] of kws) {
			const at = c.text.indexOf(k);
			if (at >= 0) {
				score += w * Math.log(1 + N / (df.get(k) || 1));
				if (firstHit < 0 || at < firstHit) firstHit = at;
			}
		}
		if (score > 0) scored.push({ ...c, score, firstHit: firstHit < 0 ? 0 : firstHit, idx: i });
	}
	scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

	// 同一标题只取一段：否则常出现「同一节的理论段 + 该节的公式块」这种冗余
	// 表格段跳过：截断后常是半行表格，读起来是噪声
	const isTable = (t) => {
		const ls = t.split('\n').filter((l) => l.trim());
		if (!ls.length) return false;
		return ls.filter((l) => l.trim().startsWith('|')).length / ls.length > 0.5;
	};
	const out = [];
	const used = new Set();
	let floor = 0; // 由首段得分定出后续段的门槛
	for (const c of scored) {
		if (out.length >= TOP_N) break;
		if (c.heading && used.has(c.heading)) continue;
		if (isTable(c.text)) continue;
		// 第二段起要求「够相关」：否则常混进一节只蹭到一个通用词的低相关段落，
		// 读的人还得自己判断这段跟题有没有关系，反而更费神
		if (out.length > 0 && c.score < floor) continue;
		out.push(c);
		if (c.heading) used.add(c.heading);
		floor = out[0].score * MIN_RATIO;
	}
	// 宁可有内容也不要空：过滤后若一段不剩，退回原始前 TOP_N
	return out.length ? out : scored.slice(0, TOP_N);
}

function excerpt(c) {
	// 从命中位置往前留一点上下文，避免断在半句
	const start = Math.max(0, c.firstHit - 120);
	const insideCode = ((c.inCode ? 1 : 0) + countFences(c.text.slice(0, start))) % 2 === 1;
	const truncated = start + MAX_EXCERPT < c.text.length;
	const ls = c.text
		.slice(start, start + MAX_EXCERPT)
		.split('\n')
		.map((l) => l.trimEnd())
		.filter((l) => l.trim() !== '')
		// 源文本身带引用块（> …）时先剥掉它的 `>`：否则套上我们的 blockquote
		// 就成了 `> > …` 嵌套引用，prettier 会另行插空行，产物天生不合规。
		// 只剥 `>` 后面跟空白的（真正的引用标记），`>>>` 这类代码不受影响。
		.filter((l) => !/^\s*>\s*$/.test(l))
		.map((l) => l.replace(/^\s*>\s/, ''));

	// 代码必须显式围起来。blockquote 里的裸代码会被 prettier 当正文排版：
	// `__name__` 变加粗、连续空格被压成一个、缩进被吃掉——实现细节会被改成错的代码。
	if (insideCode) ls.unshift('```');
	if (countFences(ls.join('\n')) % 2 === 1) ls.push('```');

	// 断在代码中间时，围栏本身就是「这里是截断的」的信号，不再额外标 …
	if (start > 0 && !insideCode) ls[0] = '…' + ls[0];
	if (truncated) ls.push('…');
	return ls.join('\n');
}

// ── 4. 逐题生成 ──
// 结论标签与 verify-path-questions.mjs 完全一致（同一套 judge，不会出现两份产物打架）
const VERDICT = {
	ok: { icon: '✅', label: '可过审' },
	quoteok: { icon: '✅', label: '倾向可过审' },
	mismatch: { icon: '🟡', label: '需修改' },
	noanchor: { icon: '🟡', label: '需人工通读' },
	delete: { icon: '🔴', label: '建议删除（待确认）' }
};

const lines = [];
lines.push('# 路线待审题 · 过审包');
lines.push('');
lines.push(`> 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
lines.push('> 用途：把每题对应的**源笔记原文段落**直接摆在题目下面，省去翻笔记找段落的时间。');
lines.push('> 每题下面的**核验结论**与 `docs/path-question-verification.md` 是同一套判定');
lines.push('> （共享 `scripts/lib/anchor-verdict.mjs`）——那份按结论分组，这份按笔记顺序给材料。');
lines.push('> 本脚本不改题目数据、不翻 `reviewed`——人工门禁仍在 AGENTS.md 第 17 条。');
lines.push('');
lines.push('<!--SUMMARY-->'); // 结论分布要跑完才知道，最后回填
lines.push('');

let qCount = 0;
let located = 0;
const tally = {};

for (const slug of files) {
	const qpath = path.join(ROOT, slug + '.json');
	if (!fs.existsSync(qpath)) continue;
	const questions = JSON.parse(fs.readFileSync(qpath, 'utf8'));
	const pending = questions.filter((q) => q.reviewed !== true);
	if (pending.length === 0) continue;

	const notePath = path.join(NOTES, slug + '.md');
	const src = loadSource(slug);

	lines.push(`## ${slug}`);
	lines.push('');

	for (const q of pending) {
		qCount++;
		const opts = q.options || [];
		const letter = (i) => String.fromCharCode(65 + i);
		const correct = letter(q.answerIndex);

		const v = judge(
			[
				...extractAnchors(q.explanation),
				...Object.values(q.distractorNotes || {}).flatMap(extractAnchors)
			],
			src
		);
		const tag = VERDICT[v.kind] || VERDICT.noanchor;
		tally[v.kind] = (tally[v.kind] || 0) + 1;

		lines.push(`### \`${q.id}\` — 正确项 ${correct}`);
		lines.push('');
		lines.push(String(q.prompt || '').trim());
		lines.push('');
		for (let i = 0; i < opts.length; i++) {
			lines.push(`- ${letter(i)}) ${opts[i]}${i === q.answerIndex ? ' **← 正确**' : ''}`);
		}
		lines.push('');
		lines.push(`**核验结论**：${tag.icon} ${tag.label} —— ${v.reason}`);
		lines.push('');
		if (q.explanation) {
			lines.push('**解析**');
			lines.push('');
			lines.push(q.explanation.trim());
			lines.push('');
		}

		lines.push('**源文依据**');
		lines.push('');
		if (!src.exists) {
			lines.push(`> ⚠️ 源笔记缺失：\`${notePath}\`（检查同步是否漏了这篇）`);
			lines.push('');
			continue;
		}
		const kws = keywords((q.prompt || '') + ' ' + opts.join(' ') + ' ' + (q.explanation || ''));
		const picks = pickChunks(src.raw, kws);
		if (picks.length === 0) {
			lines.push('> 未能自动定位到相关段落，需自行在笔记里查找。');
		} else {
			located++;
			picks.forEach((c, i) => {
				// 空 `>` 只放在段与段之间：段末再留一个会被 prettier 判为多余而删掉
				if (i > 0) lines.push('>');
				if (c.heading) {
					lines.push(`> _${c.heading.replace(/^#+\s*/, '')}_`);
					lines.push('>');
				}
				for (const l of excerpt(c).split('\n')) lines.push(`> ${l}`);
			});
		}
		lines.push('');
	}
}

// 回填结论分布（要跑完才知道）
const easy = (tally.ok || 0) + (tally.quoteok || 0);
const sum = [
	'## 结论分布（与核验报告口径一致）',
	'',
	`- ✅ 可过审：${tally.ok || 0} 道`,
	`- ✅ 倾向可过审：${tally.quoteok || 0} 道`,
	`- 🟡 需修改：${tally.mismatch || 0} 道`,
	`- 🟡 需人工通读：${tally.noanchor || 0} 道`,
	`- 🔴 建议删除（待确认）：${tally.delete || 0} 道`,
	'',
	`> 建议先翻 ✅ 的 ${easy} 道（工具已逐题给出原文依据），剩下的 ${qCount - easy} 道再通读。`
];
const idx = lines.indexOf('<!--SUMMARY-->');
lines.splice(idx, 1, ...sum);

// 末尾不留空行（prettier 要求单个 \n 结尾）
while (lines.length && lines[lines.length - 1] === '') lines.pop();

// 写盘前交给 prettier 收尾。markdown 的排版规矩琐碎且会随内容变化——
// 段落与列表之间要不要空行、斜体用 _ 还是 *、连续空格要不要保留——
// 靠生成器逐条模拟迟早漏一条，漏了就挂 CI 的 `prettier --check`。
// 直接调 prettier，产物恒等于 lint 的期望，重跑多少次都一样。
const cfg = await prettier.resolveConfig(OUT);
const out = await prettier.format(lines.join('\n') + '\n', { ...cfg, filepath: OUT });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

console.log(`过审包：${qCount} 道待审题`);
console.log(`  自动定位到源文段落：${located}`);
console.log(`  未能定位：${qCount - located}`);
console.log(`\n已写入 ${OUT}`);
