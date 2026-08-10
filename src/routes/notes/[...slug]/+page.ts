import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { base } from '$app/paths';
import { renderMarkdown } from '$lib/notes/render';
import type { NoteEntry, NotesGradable, NotesManifest, NotesQuiz } from '$lib/notes/types';
import type { ChoiceQuestion } from '$lib/quiz/types';
import type { EntryGenerator, PageLoad } from './$types';

/**
 * 阅读页改为**服务端渲染 + 全量预渲染**。
 *
 * ## 为什么从 `ssr = false` 改回来
 *
 * 原来的注释说「这 168 篇不是 SEO 入口，客户端渲染的代价可以接受」。
 * 线上实测推翻了这个判断，代价比预想的大三重：
 *
 *   1. **深层 URL 返回 404 状态码。** GitHub Pages 对未预渲染的路径返回
 *      404.html，内容靠客户端路由补上——浏览器里看着正常，但 HTTP 状态是 404。
 *      分享到社交平台、被爬虫抓到，都会当成失效链接。
 *   2. **168 篇内容对搜索引擎完全不存在。** 页面还带着 `noindex`，
 *      而这些笔记正是整个站最有价值的内容。
 *   3. **首屏要等一次 fetch 瀑布。** 打开一篇笔记先看到「正在载入正文…」。
 *
 * ## 为什么现在做得到
 *
 * `renderMarkdown` 只依赖 marked 和 highlight.js，两者在 Node 里正常工作，
 * 所以正文可以在构建期渲染成 HTML。真正需要 DOM 的 KaTeX 与 mermaid
 * 仍留在组件的 `onMount` 里，hydration 之后再渲染——公式晚一帧出现，
 * 换来的是正文可被抓取。
 *
 * ## entries 的数据来源
 *
 * 直接读磁盘上的 `static/notes/manifest.json` 而不是 fetch：
 * entries 在构建期最早阶段执行，此时还没有服务器可以 fetch。
 * manifest 由 `assets:sync` 生成，而 `build` 脚本保证它先跑。
 *
 * 笔记源仓库不存在时 manifest 是空的（count 0），entries 返回空数组，
 * 这个路由就不产出任何页面——别人 clone 本仓库后构建依然成功。
 */
export const prerender = true;

/** 构建期枚举全部 slug。rest 参数的值就是带斜杠的完整相对路径 */
export const entries: EntryGenerator = () => {
	let manifest: NotesManifest;
	try {
		manifest = JSON.parse(readFileSync('static/notes/manifest.json', 'utf8')) as NotesManifest;
	} catch {
		// 没有 manifest 说明笔记未同步，不产出任何阅读页
		return [];
	}
	return manifest.modules
		.flatMap((m) => m.sections.flatMap((s) => s.notes))
		.map((n) => ({ slug: n.slug }));
};

export interface NotePageData {
	slug: string;
	html: string;
	toc: { id: string; text: string; level: number }[];
	meta: NoteEntry | null;
	prev: NoteEntry | null;
	next: NoteEntry | null;
	/** 开放式自测题，纯展示 */
	openQuestions: string[];
	/** Tier A 可判定题 */
	gradable: ChoiceQuestion[];
	/** 正文是否含公式 / mermaid，决定客户端是否加载那两个大库 */
	hasMath: boolean;
	hasMermaid: boolean;
}

export const load: PageLoad = async ({ params, fetch }): Promise<NotePageData> => {
	const slug = params.slug;

	// 正文与三份索引一起取。索引缺失是可容忍的降级，正文缺失是 404
	// 路径必须带 base：子路径部署时静态资源在 /<base>/notes/ 下，
	// 用根绝对路径会在预渲染时 fetch failed（CI 的子路径构建校验抓到过一次）
	const [mdRes, manifestRes, quizRes, gradableRes] = await Promise.all([
		fetch(`${base}/notes/${slug.split('/').map(encodeURIComponent).join('/')}.md`),
		fetch(`${base}/notes/manifest.json`),
		fetch(`${base}/notes/quiz.json`),
		fetch(`${base}/notes/gradable.json`)
	]);

	if (!mdRes.ok) error(404, `找不到这篇笔记：${slug}`);
	const markdown = await mdRes.text();

	let meta: NoteEntry | null = null;
	let prev: NoteEntry | null = null;
	let next: NoteEntry | null = null;
	/** 正文里的相对 .md 链接要靠它判断目标是否真的收录在本站 */
	let knownSlugs: Set<string> = new Set();
	if (manifestRes.ok) {
		const manifest: NotesManifest = await manifestRes.json();
		const flat = manifest.modules.flatMap((m) => m.sections.flatMap((s) => s.notes));
		knownSlugs = new Set(flat.map((n) => n.slug));
		const i = flat.findIndex((n) => n.slug === slug);
		meta = i >= 0 ? flat[i] : null;
		prev = i > 0 ? flat[i - 1] : null;
		next = i >= 0 && i < flat.length - 1 ? flat[i + 1] : null;
	}

	const openQuestions = quizRes.ok ? (((await quizRes.json()) as NotesQuiz).items[slug] ?? []) : [];
	const gradable = gradableRes.ok
		? (((await gradableRes.json()) as NotesGradable).items?.[slug] ?? [])
		: [];

	// 传入 slug 与已知 slug 集合，把笔记之间的相对 .md 链接改写成站内路由。
	// 不传的话正文里那些链接会 404 —— 改成 SSR 之后 SvelteKit 的爬虫会因此让构建失败，
	// 而那正是在报告一个之前一直存在、只是没人发现的真实缺陷。
	const rendered = renderMarkdown(markdown, { slug, knownSlugs, base });

	return {
		slug,
		html: rendered.html,
		toc: rendered.toc,
		meta,
		prev,
		next,
		openQuestions,
		gradable,
		// manifest 有标记就用它，缺失时回退到内容启发式，避免漏渲染公式
		hasMath: meta?.hasMath ?? /\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+\$/.test(markdown),
		hasMermaid: meta?.hasMermaid ?? /```mermaid/.test(markdown)
	};
};
