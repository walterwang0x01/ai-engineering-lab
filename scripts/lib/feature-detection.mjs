/**
 * Markdown 特性检测（构建脚本版）。
 *
 * 这里不能直接 import src 下的 TypeScript；Node 在 notes:sync 阶段不跑 TS loader。
 * 与 `src/lib/notes/feature-detection.ts` 保持同一契约，render.spec.ts 会用同一组样例
 * 对两份实现做一致性门禁。任何一边单改，测试都会失败。
 */

/**
 * 去掉代码后再检测。美元价格、模板变量、正则表达式最常藏在代码与表格里，
 * 直接对原文跑 `$...$` 会把 `$5/M ... $15/M` 横跨成一个巨大“公式”。
 */
/** @param {string} markdown */
function proseOnly(markdown) {
	return markdown
		.replace(/```[\s\S]*?```/g, '')
		.replace(/~~~[\s\S]*?~~~/g, '')
		.replace(/`[^`\n]*`/g, '');
}

/**
 * 行内 `$...$` 的内容是否像数学，而不是价格/模板/自然语言。
 * @param {string} raw
 */
function plausibleInlineMath(raw) {
	const value = raw.trim();
	if (value === '') return false;
	// ${topic}、${i + 1} 是模板插值，不是数学。
	if (value.startsWith('{')) return false;
	// $5/M、$0.06/分、$3000 万：美元符号后以数字开头，本站语料里全是价格。
	if (/^[+-]?\d/.test(value)) return false;
	// 表格竖线或中文句子说明正则跨过了价格之间的文本。
	if (value.includes('|') || /[\p{Script=Han}]/u.test(value)) return false;

	// LaTeX 命令、运算符/上下标，或单个变量名。
	return (
		/\\[A-Za-z]+/.test(value) || /[=+*/^_{}<>]/.test(value) || /^[A-Za-z][A-Za-z0-9_]*$/.test(value)
	);
}

/** @param {string} markdown */
export function detectMarkdownFeatures(markdown) {
	const prose = proseOnly(markdown);
	const blockMath = /\$\$[\s\S]+?\$\$/.test(prose);
	let inlineMath = false;
	for (const match of prose.matchAll(/(?<!\\)\$([^$\n]+?)\$/g)) {
		if (plausibleInlineMath(match[1])) {
			inlineMath = true;
			break;
		}
	}

	return {
		hasMath: blockMath || inlineMath,
		hasMermaid: /```mermaid(?:\s|\n)/.test(markdown)
	};
}
