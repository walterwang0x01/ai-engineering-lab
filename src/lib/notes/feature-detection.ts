/**
 * Markdown 特性检测（应用运行时版）。
 *
 * 构建期同步脚本不能直接加载 TypeScript，因此 `scripts/lib/feature-detection.mjs`
 * 有一份等价实现。两份实现由 render.spec.ts 的同一组契约样例锁住；任何一边
 * 单独修改都会失败。不要把 `hasMath` 当作「适合做参数交互」——它只回答
 * 「阅读页需不需要懒加载 KaTeX」。交互机会由独立 registry 表达。
 */

function proseOnly(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, '')
		.replace(/~~~[\s\S]*?~~~/g, '')
		.replace(/`[^`\n]*`/g, '');
}

export function isPlausibleInlineMath(raw: string): boolean {
	const value = raw.trim();
	if (value === '') return false;
	if (value.startsWith('{')) return false; // ${topic} 模板插值
	if (/^[+-]?\d/.test(value)) return false; // 本站语料中是 $5/M、$0.06/分、$3000 万
	if (value.includes('|') || /[\p{Script=Han}]/u.test(value)) return false;

	return (
		/\\[A-Za-z]+/.test(value) || /[=+*/^_{}<>]/.test(value) || /^[A-Za-z][A-Za-z0-9_]*$/.test(value)
	);
}

export function detectMarkdownFeatures(markdown: string): {
	hasMath: boolean;
	hasMermaid: boolean;
} {
	const prose = proseOnly(markdown);
	const blockMath = /\$\$[\s\S]+?\$\$/.test(prose);
	let inlineMath = false;
	for (const match of prose.matchAll(/(?<!\\)\$([^$\n]+?)\$/g)) {
		if (isPlausibleInlineMath(match[1])) {
			inlineMath = true;
			break;
		}
	}

	return {
		hasMath: blockMath || inlineMath,
		hasMermaid: /```mermaid(?:\s|\n)/.test(markdown)
	};
}
