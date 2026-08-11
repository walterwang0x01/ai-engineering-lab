/**
 * Markdown 渲染管线。
 *
 * 严格懒加载 KaTeX 和 mermaid（AGENTS.md 硬约定 #12 的同类要求）：
 * 这两个库体积不小，多数笔记不含公式或图表，阅读页首屏不该为它们付出成本。
 * 调用方先用 detectFeatures 判断，只有真正需要时才 import 对应模块。
 *
 * marked 和 highlight.js 体积较小（各数十 KB），且几乎每篇笔记都含代码块，
 * 直接静态引入即可，没有懒加载的必要——为它们再拆一次动态 import
 * 只会多一次网络往返，换不来实际的首屏收益。
 */

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
// 笔记里出现的语言：Python/JS/TS 是主力，Bash 和 JSON 偶尔出现。
// 按需注册而非 import 'highlight.js' 全量包，避免把几十种语言都打进 bundle。
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('plaintext', plaintext);

export interface TocEntry {
	id: string;
	text: string;
	/** 2~4 级标题，一级标题是篇名不进目录 */
	level: number;
}

export interface RenderResult {
	html: string;
	toc: TocEntry[];
}

/** 中文标题转 URL 安全的 slug id，用于目录锚点跳转 */
function slugify(text: string, seen: Map<string, number>): string {
	const base =
		text
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s-]/gu, '')
			.replace(/\s+/g, '-') || 'section';
	const count = seen.get(base) ?? 0;
	seen.set(base, count + 1);
	return count === 0 ? base : `${base}-${count}`;
}

/**
 * 检测正文是否含公式 / mermaid 图。
 * 与 scripts/sync-notes.mjs 的 detectFeatures 是同一套启发式，
 * 两处独立判断而不是共享一份代码——manifest 里已经存了这两个布尔值，
 * 正常路径用 manifest 的结果即可；这个函数是给「manifest 缺失/降级」场景兜底的。
 */
export function detectFeatures(markdown: string): { hasMath: boolean; hasMermaid: boolean } {
	return {
		hasMath: /\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+\$/.test(markdown),
		hasMermaid: /```mermaid/.test(markdown)
	};
}

/**
 * 渲染 markdown 为 HTML，同时抽取标题目录。
 *
 * 公式和 mermaid 代码块先被占位替换保护起来，避免 marked 把公式里的
 * `_`、`*` 当成斜体/粗体语法误解析，也避免 mermaid 源码被当作普通代码块高亮。
 * 占位符在渲染后被替换回真实内容，公式/图表的实际渲染在调用方按需触发
 * （renderMath / renderMermaid），这里只负责把内容原样保留到 DOM 里。
 */
export interface RenderOptions {
	/**
	 * 当前笔记的 slug，用于把正文里的相对 `.md` 链接解析成站内路由。
	 *
	 * 不传则跳过链接改写（单元测试和纯渲染场景用）。
	 */
	slug?: string;
	/** manifest 里存在的全部 slug。用来判断一条内部链接是否真的指向已同步的篇目 */
	knownSlugs?: ReadonlySet<string>;
	/** 站点 base 路径，子路径部署时需要。默认空串 */
	base?: string;
}

/**
 * 把正文里的相对 `.md` 链接解析成本站路由。
 *
 * 为什么必须做：笔记之间大量互相引用（`../02-llm/05-推理优化/01-KV-Cache与显存分析.md`），
 * 这些路径在源仓库里成立，在网站上不成立。改成 SSR 预渲染之后，SvelteKit 的
 * 爬虫会跟着这些链接走并因 404 让构建失败——那其实是在报告一个真实缺陷：
 * 之前客户端渲染时它们同样是死链，只是没人发现。
 *
 * **所有相对链接**都走这条规则，不只是 .md：源仓库里还有指向目录的链接
 * （`../02-经典算法/`）和示例代码里的占位符（`[x](URL)`），它们在站内都没有对应页面。
 * 解析后在 manifest 里查不到的一律返回 null，调用方渲染成不可点的文本，
 * 而不是留一个会 404 的链接。
 */
function resolveNoteLink(
	href: string,
	slug: string,
	knownSlugs: ReadonlySet<string>,
	base: string
): string | null {
	// 外链、协议链接、纯锚点原样保留
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) {
		return href;
	}

	const [rawPath, hash = ''] = href.split('#');
	if (rawPath === '') return href;

	const fromDir = slug.split('/').slice(0, -1);
	const raw = decodeURIComponent(rawPath);
	const segments = raw.startsWith('/')
		? raw.replace(/^\//, '').split('/')
		: [...fromDir, ...raw.split('/')];

	/** 逐段消解 . 与 ..。不能用 node:path，这个文件要在浏览器里跑 */
	const stack: string[] = [];
	for (const seg of segments) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') stack.pop();
		else stack.push(seg);
	}

	// 去掉 .md 后缀再查：源仓库里写的是文件路径，站内是路由
	const target = stack.join('/').replace(/\.md$/i, '');
	if (!knownSlugs.has(target)) return null;

	const encoded = target.split('/').map(encodeURIComponent).join('/');
	return `${base}/notes/${encoded}${hash ? `#${hash}` : ''}`;
}

export function renderMarkdown(markdown: string, options: RenderOptions = {}): RenderResult {
	const toc: TocEntry[] = [];
	const seen = new Map<string, number>();
	const { slug, knownSlugs, base = '' } = options;

	const marked = new Marked({
		gfm: true,
		breaks: false
	});

	marked.use({
		renderer: {
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				const plain = tokens.map((t) => ('text' in t ? t.text : '')).join('');
				if (depth >= 2 && depth <= 4) {
					const id = slugify(plain, seen);
					toc.push({ id, text: plain, level: depth });
					return `<h${depth} id="${id}">${text}</h${depth}>\n`;
				}
				return `<h${depth}>${text}</h${depth}>\n`;
			},
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens);
				const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

				// 没有 slug 上下文时不改写，保持纯渲染行为
				if (!slug || !knownSlugs) {
					return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
				}

				const resolved = resolveNoteLink(href, slug, knownSlugs, base);
				if (resolved === null) {
					// 指向未同步篇目：渲染成不可点的文本，不留 404 链接
					return `<span class="link-unavailable" title="这篇笔记未收录在本站">${text}</span>`;
				}
				const external = /^https?:\/\//i.test(resolved);
				const rel = external ? ' rel="noreferrer"' : '';
				return `<a href="${escapeHtml(resolved)}"${titleAttr}${rel}>${text}</a>`;
			},
			code({ text, lang }) {
				if (lang === 'mermaid') {
					// data 属性标记，交给调用方的 renderMermaid 按需替换成 svg
					return `<pre class="mermaid-pending" data-mermaid-source="${encodeURIComponent(text)}">${escapeHtml(text)}</pre>\n`;
				}
				const language = lang && hljs.getLanguage(lang) ? lang : undefined;
				/*
				 * 没声明语言就**不高亮**，而不是 hljs.highlightAuto() 去猜。
				 *
				 * 笔记里 3511 个围栏块没有语言标记，只有约 800 个有。没标记的那批绝大多数
				 * 是伪代码、数学推导、终端输出、目录树，自动检测在它们身上会自信地猜错：
				 * 反向传播那篇的伪代码被整段染成「字符串绿」、`for` 被当成关键字。
				 *
				 * 站内长期没有任何 hljs 主题，所以误判一直是不可见的——所有 span 都渲染成
				 * 正文色。一旦上色，误判就从无害变成了错误信息。猜错的高亮比不高亮更糟，
				 * 这与「错误的技术内容比没有内容更糟」是同一条原则。
				 *
				 * `render.spec.ts` 有一条守着这个：没有语言标记的块里不能出现 hljs span。
				 */
				const highlighted = language ? hljs.highlight(text, { language }).value : escapeHtml(text);
				return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>\n`;
			}
		}
	});

	const html = marked.parse(markdown, { async: false });
	return { html, toc };
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * 在给定容器内查找并渲染所有公式（$$...$$ 块级 / $...$ 行内）。
 * KaTeX 仅在此函数被调用时才动态加载——调用方必须先确认 hasMath 才调用。
 */
export async function renderMath(container: HTMLElement): Promise<void> {
	const [{ default: katex }] = await Promise.all([
		import('katex'),
		import('katex/dist/katex.min.css')
	]);

	// 在文本节点里找 $$...$$ 和 $...$，跳过已经是 <code>/<pre> 内部的内容
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (parent?.closest('code, pre')) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		}
	});

	const targets: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (/\$/.test(node.textContent ?? '')) targets.push(node as Text);
	}

	for (const textNode of targets) {
		const raw = textNode.textContent ?? '';
		if (!raw.includes('$')) continue;

		const frag = document.createDocumentFragment();
		let cursor = 0;
		const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g;
		let m: RegExpExecArray | null;
		let matched = false;
		while ((m = re.exec(raw))) {
			matched = true;
			if (m.index > cursor) frag.append(raw.slice(cursor, m.index));
			const span = document.createElement('span');
			const isBlock = m[1] !== undefined;
			try {
				katex.render(m[1] ?? m[2] ?? '', span, { throwOnError: false, displayMode: isBlock });
			} catch {
				span.textContent = m[0];
			}
			frag.append(span);
			cursor = re.lastIndex;
		}
		if (!matched) continue;
		if (cursor < raw.length) frag.append(raw.slice(cursor));
		textNode.replaceWith(frag);
	}
}

/**
 * 渲染容器内所有 `.mermaid-pending` 占位为图表。
 * mermaid 仅在此函数被调用时才动态加载——调用方必须先确认 hasMermaid 才调用。
 */
export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
	const nodes = container.querySelectorAll<HTMLElement>('.mermaid-pending');
	if (nodes.length === 0) return;

	const { default: mermaid } = await import('mermaid');
	mermaid.initialize({ startOnLoad: false, theme: 'dark' });

	let i = 0;
	for (const node of nodes) {
		const source = decodeURIComponent(node.dataset.mermaidSource ?? '');
		const id = `mermaid-${Date.now()}-${i++}`;
		try {
			const { svg } = await mermaid.render(id, source);
			const wrapper = document.createElement('div');
			wrapper.className = 'mermaid-rendered';
			wrapper.innerHTML = svg;
			node.replaceWith(wrapper);
		} catch {
			node.classList.remove('mermaid-pending');
			node.classList.add('mermaid-error');
		}
	}
}
