/**
 * 把待过审的 Tier A 题打印成可读清单。
 *
 * ## 为什么需要它
 *
 * `reviewed` 必须人工翻成 `true`（AGENTS.md 第 17 条），而 LLM 一次能起草几十道。
 * 在 JSON diff 里过审是**扫结构**：括号、下标、转义。而过审要做的是**读内容**：
 * 这个干扰项是不是真实误解？这个解析能不能在原文里找到依据？
 * 两件事需要的注意力不一样，用错载体会让人把「格式没错」误当成「内容没错」。
 *
 * 所以这里只做一件事：把题按笔记分组、标出答案、把每个干扰项和它的解释并排放，
 * 让过审变成阅读任务。它不改任何文件——**翻 `reviewed` 必须是人手动做的**，
 * 给脚本加一个 `--approve` 开关就等于把门禁交回给自动化，那条门禁的全部意义
 * 就是「有人真的读过这道题」。
 *
 * ## 用法
 *
 *   npm run notes:review                 # 列出全部待审
 *   npm run notes:review -- 02-llm       # 只看某个前缀
 *   npm run notes:review -- --reviewed   # 反过来，看已过审的（复核用）
 *   npm run notes:review -- --stats      # 只要统计
 *   npm run notes:review -- --path       # 只看学习路线上的 27 篇
 *
 * `--path` 存在的理由：全站 400+ 道待审，一次过完不现实，而过审的收益
 * 高度集中在路线上——路线是新手唯一被引导着走完的一段，其余笔记按需查阅。
 * 把清单收到 60 来道，过审才是件能坐下来做完的事。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'content/note-questions';

const args = process.argv.slice(2);
const wantReviewed = args.includes('--reviewed');
const statsOnly = args.includes('--stats');
const pathOnly = args.includes('--path');
const filter = args.find((a) => !a.startsWith('--'));

/**
 * 学习路线上的 slug 集合。
 *
 * 从 `learning-path.ts` 里正则取出，而不是 import——这个脚本是纯 Node，
 * 不经过 vite/TS 转译，import 一个 `.ts` 跑不起来。
 *
 * 代价是和源码的书写格式耦合了。所以取不到时**报错退出而不是静默放行**：
 * 静默会让 `--path` 退化成「列出 0 道题」，看起来像「路线上的题都过审了」。
 */
async function loadPathSlugs() {
	const src = await readFile('src/lib/nav/learning-path.ts', 'utf8');
	const slugs = [...src.matchAll(/^\s*slug: '([^']+)',$/gm)].map((m) => m[1]);
	if (slugs.length === 0) {
		throw new Error(
			'从 src/lib/nav/learning-path.ts 里没取到任何 slug。' +
				'该文件的格式可能变了，请更新本脚本的正则——不要让它静默返回空集。'
		);
	}
	return new Set(slugs);
}

const pathSlugs = pathOnly ? await loadPathSlugs() : null;

/** ANSI。管道输出时（不是 TTY）自动关掉，方便 `| less` 或重定向到文件 */
const tty = process.stdout.isTTY;
const c = {
	dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
	bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
	green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
	red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
	cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
	yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s)
};

/** 递归收集题库文件，返回相对 ROOT 的 slug */
async function collect(dir = ROOT) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await collect(full)));
		else if (entry.name.endsWith('.json')) {
			out.push({ file: full, slug: path.relative(ROOT, full).replace(/\.json$/, '') });
		}
	}
	return out.sort((a, b) => a.slug.localeCompare(b.slug, 'zh'));
}

/** 把长文按宽度折行并缩进，避免终端里糊成一片 */
function wrap(text, indent, width = 96) {
	const pad = ' '.repeat(indent);
	const lines = [];
	let line = '';
	// 按字符累积而不是按空格断词：中文没有空格，按词断会整段不折
	for (const ch of text) {
		line += ch;
		if (line.length >= width) {
			lines.push(line);
			line = '';
		}
	}
	if (line) lines.push(line);
	return lines.map((l) => pad + l).join('\n');
}

// 过滤放在循环外，好让下面的 total / empty 等统计都只反映筛剩下的范围，
// 而不是「全站总数」和「筛后明细」混在一起
const files = (await collect()).filter(
	({ slug }) => (!filter || slug.includes(filter)) && (!pathSlugs || pathSlugs.has(slug))
);
let total = 0;
let shown = 0;
const perFile = [];

for (const { file, slug } of files) {
	/** @type {Array<Record<string, unknown>>} */
	const questions = JSON.parse(await readFile(file, 'utf8'));
	total += questions.length;

	const picked = questions.filter((q) => (q.reviewed === true) === wantReviewed);
	perFile.push({ slug, file, all: questions.length, picked: picked.length });
	// shown 要在 statsOnly 短路之前累加，否则 --stats 永远报 0
	shown += picked.length;
	if (picked.length === 0 || statsOnly) continue;

	console.log('');
	console.log(c.bold(c.cyan(`▌ ${slug}`)));
	console.log(c.dim(`  ${file}`));

	for (const q of picked) {
		console.log('');
		console.log(`  ${c.bold(q.id)}`);
		console.log(wrap(String(q.prompt), 4));
		console.log('');
		q.options.forEach((opt, i) => {
			const right = i === q.answerIndex;
			const mark = right ? c.green('✔') : c.red('✗');
			console.log(`    ${mark} ${right ? c.green(opt) : opt}`);
			const note = q.distractorNotes?.[String(i)];
			if (note) console.log(c.dim(wrap(`↳ ${note}`, 8)));
		});
		if (q.hint) {
			console.log('');
			console.log(c.yellow('    提示'));
			console.log(c.dim(wrap(String(q.hint), 6)));
		}
		console.log('');
		console.log(c.yellow('    解析'));
		console.log(c.dim(wrap(String(q.explanation), 6)));
	}
}

// ── 统计 ──
const pendingFiles = perFile.filter((f) => f.picked > 0);
const empty = perFile.filter((f) => f.all === 0);

console.log('');
console.log(c.bold('── 统计 ──'));
console.log(`  题库文件      ${perFile.length} 个（其中 ${empty.length} 个是刻意的空数组）`);
console.log(`  题目总数      ${total}`);
console.log(
	`  ${wantReviewed ? '已过审' : '待过审'}        ${shown}，分布在 ${pendingFiles.length} 个文件`
);

if (!wantReviewed && shown > 0) {
	console.log('');
	console.log(c.dim('  过审方式：读完一道就把该题的 "reviewed": false 改成 true。'));
	console.log(c.dim('  干扰项不是真实误解、或解析在原文里找不到依据的，删掉而不是修补——'));
	console.log(c.dim('  Tier A 题存在的意义是命中一个具体误解，只是「听起来合理」比没有题更糟。'));
}

if (empty.length > 0 && !statsOnly) {
	console.log('');
	console.log(c.dim('  空数组（该笔记没有可程序判定的考点，属正常）：'));
	for (const e of empty) console.log(c.dim(`    ${e.slug}`));
}
