import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

/**
 * 笔记正文里的链接改写门禁。
 *
 * 这段逻辑是改成 SSR 预渲染时被迫加上的：SvelteKit 的爬虫跟着正文链接走，
 * 发现 508 条相对 `.md` 链接在站内全是死链——它们在源仓库里成立，在网站上不成立。
 * 客户端渲染时同样是死链，只是没有任何东西会报告出来。
 *
 * 所以这里的每条断言都对应一类真实存在的链接形态（数量来自对 168 篇的扫描）。
 */

const SLUG = '01-machine-learning/02-经典算法/03-集成学习';
const KNOWN = new Set([
	SLUG,
	'01-machine-learning/01-机器学习基础/02-模型评估与度量选择',
	'02-llm/05-推理优化/01-KV-Cache与显存分析'
]);

function render(md: string) {
	return renderMarkdown(md, { slug: SLUG, knownSlugs: KNOWN }).html;
}

describe('相对 .md 链接改写成站内路由', () => {
	it('同级目录', () => {
		expect(render('[集成](03-集成学习.md)')).toContain(
			`href="/notes/${encodeURIComponent('01-machine-learning')}`
		);
	});

	it('跨模块的 ../ 路径逐段消解', () => {
		const html = render('[评估](../01-机器学习基础/02-模型评估与度量选择.md)');
		const expected = '01-machine-learning/01-机器学习基础/02-模型评估与度量选择'
			.split('/')
			.map(encodeURIComponent)
			.join('/');
		expect(html).toContain(`href="/notes/${expected}"`);
	});

	it('多级 ../../ 也能解析', () => {
		const html = render('[KV](../../02-llm/05-推理优化/01-KV-Cache与显存分析.md)');
		expect(html).toContain(encodeURIComponent('05-推理优化'));
	});

	it('保留锚点', () => {
		expect(render('[节](../01-机器学习基础/02-模型评估与度量选择.md#f1)')).toContain('#f1"');
	});

	it('base 前缀用于子路径部署', () => {
		const html = renderMarkdown('[x](03-集成学习.md)', {
			slug: SLUG,
			knownSlugs: KNOWN,
			base: '/ai-engineering-lab'
		}).html;
		expect(html).toContain('href="/ai-engineering-lab/notes/');
	});
});

describe('不该改写的链接', () => {
	it('外链原样保留并加 rel=noreferrer', () => {
		const html = render('[d2l](https://zh.d2l.ai/)');
		expect(html).toContain('href="https://zh.d2l.ai/"');
		expect(html).toContain('rel="noreferrer"');
	});

	it('纯锚点原样保留', () => {
		expect(render('[回顶](#top)')).toContain('href="#top"');
	});

	it('mailto 等协议链接原样保留', () => {
		expect(render('[写信](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
	});
});

describe('指向站外不存在内容的链接必须变成不可点文本', () => {
	it('未同步的篇目（加密目录 / README / 路线图）', () => {
		const html = render('[路线图](../../ai-roadmap.md)');
		expect(html).toContain('link-unavailable');
		expect(html).not.toContain('href="/notes/');
		// 文字要留着，读者仍能看到它提到了什么
		expect(html).toContain('路线图');
	});

	it('指向目录的链接（源仓库里有 2 条）', () => {
		const html = render('[经典算法](../02-经典算法/)');
		expect(html).toContain('link-unavailable');
	});

	it('示例代码里的占位符不会变成链接', () => {
		expect(render('[见](URL)')).toContain('link-unavailable');
	});

	it('绝不留下任何 .md 结尾的 href', () => {
		const html = render(
			['[a](03-集成学习.md)', '[b](../unknown/x.md)', '[c](https://e.com/y.md)'].join('\n\n')
		);
		// 外链允许保留 .md，站内相对链接一条都不许剩
		const internal = [...html.matchAll(/href="(?!https?:)[^"]*"/g)].map((m) => m[0]);
		expect(internal.every((h) => !h.endsWith('.md"'))).toBe(true);
	});
});

describe('不传 slug 时保持纯渲染行为', () => {
	it('链接原样输出，供单元测试与非笔记场景使用', () => {
		const html = renderMarkdown('[x](../y.md)').html;
		expect(html).toContain('href="../y.md"');
		expect(html).not.toContain('link-unavailable');
	});
});
