#!/usr/bin/env node
/**
 * 构建期同步 AI 工程笔记 → static/notes/。
 *
 * 产出：
 *   1. 原始 md 文件（保持目录结构，供 /notes/[...slug] 客户端 fetch 渲染）
 *   2. manifest.json —— 按模块/章节组织的篇目元数据（标题、字数、预估阅读分钟、
 *      是否含代码块/公式/mermaid），供 /notes 学习路径页渲染
 *   3. quiz.json —— 从「读完你能回答的 3 个问题」提取的自测题，按 slug 索引
 *
 * 数据源：~/PycharmProjects/tech-learning-and-projects/learning-notes/00-ai/
 * （可用 NOTES_SRC 环境变量覆盖）
 *
 * 加密目录处理：源仓库用 git-crypt 加密了两处目录，按 .gitattributes 规则
 * 硬编码路径跳过。同时做内容层启发式判断作为兜底——万一某天新增了别的
 * 加密路径而这个脚本没同步更新，二进制/非法 UTF-8 内容也不会被当作笔记抽取，
 * 而是计入 skippedEncrypted 并跳过。
 *
 * 幂等：每次运行先清空目标目录再重建，不依赖上次产物的残留状态。
 * 源仓库不存在时不报错退出，写空 manifest/quiz 让构建能继续
 * （否则别人 clone 这个仓库后没有笔记源目录，构建就会挂）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'static', 'notes');

/** git-crypt 加密目录，按仓库 .gitattributes 规则硬编码排除 */
const ENCRYPTED_DIR_PATTERNS = ['04-ai-agent/20-Agent支付', '24-2026技术更新'];

const NOTES_SRC_CANDIDATES = [
	process.env.NOTES_SRC,
	path.resolve(ROOT, '../tech-learning-and-projects/learning-notes/00-ai'),
	path.resolve(ROOT, '../../tech-learning-and-projects/learning-notes/00-ai')
].filter(Boolean);

/** 模块 id → 展示名。缺失的模块用目录名兜底（prettify 去掉数字前缀） */
const MODULE_LABELS = {
	'00-入门准备': '入门准备',
	'01-machine-learning': '机器学习原理',
	'02-llm': '大语言模型',
	'03-实战项目': '实战项目',
	'04-ai-agent': 'AI Agent 工程'
};

function findSource() {
	for (const p of NOTES_SRC_CANDIDATES) {
		if (p && fs.existsSync(p)) return p;
	}
	return null;
}

function isEncryptedPath(relPath) {
	return ENCRYPTED_DIR_PATTERNS.some((pat) => relPath.includes(pat));
}

/**
 * 内容层启发式判断：是否像 git-crypt 密文而非普通 markdown。
 *
 * git-crypt 密文以 12 字节头 "\x00GITCRYPT\x00" 开头；就算头部识别不到，
 * 加密后的字节流也几乎不可能是合法 UTF-8（AES-CTR 输出的高比例字节
 * 落在 UTF-8 续接字节的非法位置）。用 TextDecoder 严格模式检测。
 */
function looksEncrypted(buf) {
	if (buf.length >= 9 && buf.subarray(0, 9).toString('latin1') === '\x00GITCRYPT') return true;
	if (buf.includes(0)) return true; // 文本文件不应含 NUL 字节
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(buf);
		return false;
	} catch {
		return true;
	}
}

function rmrf(dir) {
	fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

/** 去掉数字前缀，用于展示（"02-llm" → "llm"，"01-入门" → "入门"） */
function prettify(name) {
	return name.replace(/\.md$/, '').replace(/^\d+[-.]?\s*/, '');
}

function moduleLabel(moduleId) {
	return MODULE_LABELS[moduleId] ?? prettify(moduleId);
}

/** 提取一级标题作为笔记标题，没有则用文件名兜底 */
function extractTitle(content, fallback) {
	const m = content.match(/^#\s+(.+)$/m);
	return m ? m[1].trim() : fallback;
}

/**
 * 从「读完你能回答的 3 个问题」blockquote 里提取有序列表项。
 * 格式约定：
 *   > **读完你能回答的 3 个问题**
 *   >
 *   > 1. 问题一
 *   > 2. 问题二
 *   > 3. 问题三
 */
function extractQuestions(content) {
	const anchor = content.indexOf('读完你能回答的');
	if (anchor === -1) return [];

	const chunk = content.slice(anchor, anchor + 1500);
	const questions = [];
	const re = /^>\s*(\d)\.\s*(.+?)$/gm;
	let m;
	while ((m = re.exec(chunk)) !== null) {
		const text = m[2].trim();
		if (text) questions.push(text);
		if (questions.length >= 3) break;
	}
	return questions;
}

/** 中文技术文档约 400 字/分钟估算阅读时长，含代码块时打八折（代码读得更慢，但占比通常不高） */
function estimateMinutes(content, wordCount) {
	const hasCode = /```/.test(content);
	const wpm = hasCode ? 320 : 400;
	return Math.max(1, Math.round(wordCount / wpm));
}

/** 统计正文字数：中文按字符数，英文按空格分词数的近似（技术笔记以中文为主，简单按非空白字符数计） */
function countWords(content) {
	const stripped = content
		.replace(/^#\s+.+$/m, '') // 去掉一级标题本身
		.replace(/```[\s\S]*?```/g, '') // 代码块不计入正文字数
		.replace(/[ \t]+/g, ' ');
	return stripped.replace(/\s/g, '').length;
}

function detectFeatures(content) {
	return {
		hasCode: /```(?!mermaid)\w*\n/.test(content),
		hasMath: /\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+\$/.test(content),
		hasMermaid: /```mermaid/.test(content)
	};
}

/** 递归遍历源目录，收集笔记文件；跳过加密目录、隐藏目录、非 md 文件 */
function walk(dir, relBase, stats) {
	const collected = [];
	if (!fs.existsSync(dir)) return collected;

	for (const entry of fs
		.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
		const rel = path.posix.join(relBase, entry.name);
		const abs = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			if (entry.name.startsWith('.')) continue;
			if (isEncryptedPath(rel)) {
				stats.skippedEncryptedDirs += 1;
				continue;
			}
			collected.push(...walk(abs, rel, stats));
			continue;
		}

		if (!entry.name.endsWith('.md')) continue;
		// 根目录下的索引文件（README、路线图、学习进度）不是笔记正文，跳过；
		// 真正的笔记都归属在模块子目录下
		if (relBase === '') continue;

		const buf = fs.readFileSync(abs);
		if (looksEncrypted(buf)) {
			stats.skippedEncryptedFiles += 1;
			continue;
		}

		collected.push({ rel, content: buf.toString('utf8') });
	}

	return collected;
}

function main() {
	console.log('📚 同步 AI 工程笔记 → static/notes/ …');

	rmrf(OUT_DIR);
	ensureDir(OUT_DIR);

	const source = findSource();
	if (!source) {
		console.warn('  ⚠️  未找到笔记源仓库（tech-learning-and-projects），写空 manifest 让构建继续');
		console.warn(`  ⚠️  已尝试路径: ${NOTES_SRC_CANDIDATES.join(', ')}`);
		fs.writeFileSync(
			path.join(OUT_DIR, 'manifest.json'),
			JSON.stringify({ generatedAt: new Date().toISOString(), count: 0, modules: [] }, null, 2)
		);
		fs.writeFileSync(
			path.join(OUT_DIR, 'quiz.json'),
			JSON.stringify({ generatedAt: new Date().toISOString(), total: 0, items: {} }, null, 2)
		);
		return;
	}

	console.log(`  📂 源: ${source}`);

	const stats = { skippedEncryptedDirs: 0, skippedEncryptedFiles: 0 };
	const files = walk(source, '', stats);

	const entries = [];
	const quizItems = {};
	let totalQuestions = 0;
	let notesWithQuiz = 0;

	for (const f of files) {
		const parts = f.rel.split('/');
		const moduleId = parts[0];
		const section = parts.length > 2 ? parts[1] : '';
		const slug = f.rel.replace(/\.md$/, '');

		const destPath = path.join(OUT_DIR, f.rel);
		ensureDir(path.dirname(destPath));
		fs.writeFileSync(destPath, f.content, 'utf8');

		const title = extractTitle(f.content, prettify(parts[parts.length - 1]));
		const wordCount = countWords(f.content);
		const features = detectFeatures(f.content);

		entries.push({
			slug,
			title,
			module: moduleId,
			moduleLabel: moduleLabel(moduleId),
			section: section ? prettify(section) : '',
			wordCount,
			minutes: estimateMinutes(f.content, wordCount),
			...features
		});

		const questions = extractQuestions(f.content);
		if (questions.length > 0) {
			quizItems[slug] = questions;
			totalQuestions += questions.length;
			notesWithQuiz += 1;
		}
	}

	// 按模块 → 章节分组，用于 /notes 学习路径页
	const moduleMap = new Map();
	for (const e of entries) {
		if (!moduleMap.has(e.module)) {
			moduleMap.set(e.module, { id: e.module, label: e.moduleLabel, sections: new Map() });
		}
		const mod = moduleMap.get(e.module);
		const sectionKey = e.section || '';
		if (!mod.sections.has(sectionKey)) mod.sections.set(sectionKey, []);
		mod.sections.get(sectionKey).push({
			slug: e.slug,
			title: e.title,
			wordCount: e.wordCount,
			minutes: e.minutes,
			hasCode: e.hasCode,
			hasMath: e.hasMath,
			hasMermaid: e.hasMermaid,
			hasQuiz: Boolean(quizItems[e.slug])
		});
	}

	const modules = [...moduleMap.values()]
		.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))
		.map((mod) => ({
			id: mod.id,
			label: mod.label,
			notes: [...mod.sections.values()].reduce((n, arr) => n + arr.length, 0),
			sections: [...mod.sections.entries()]
				.sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
				.map(([section, notes]) => ({ section, notes }))
		}));

	ensureDir(OUT_DIR);
	fs.writeFileSync(
		path.join(OUT_DIR, 'manifest.json'),
		JSON.stringify(
			{ generatedAt: new Date().toISOString(), count: entries.length, modules },
			null,
			2
		)
	);
	fs.writeFileSync(
		path.join(OUT_DIR, 'quiz.json'),
		JSON.stringify(
			{ generatedAt: new Date().toISOString(), total: totalQuestions, items: quizItems },
			null,
			2
		)
	);

	console.log(
		`  ✅ 笔记: ${entries.length} 篇（跳过加密目录 ${stats.skippedEncryptedDirs} 个 / 加密文件 ${stats.skippedEncryptedFiles} 个）`
	);
	console.log(`  ✅ 自测题: ${notesWithQuiz} 篇笔记 / ${totalQuestions} 道题`);
	for (const mod of modules) {
		console.log(`     ${mod.label}: ${mod.notes} 篇`);
	}
}

main();
