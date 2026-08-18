/**
 * 笔记内嵌部件的门禁。
 *
 * 守两件事：
 * 1. 每个 slug 在 manifest 里真实存在（拼错 slug 会让部件永远不出现）
 * 2. 每个 `afterHeading` 在那篇笔记的 markdown 里真实是个标题
 *
 * 第 2 条是这个文件存在的理由。锚点靠标题文本匹配，作者在笔记源里改一个字，
 * 部件就静默消失——页面照常渲染、构建照常绿、测试照常过，只是那个交互没了。
 * 这类失效没有任何可见症状，只能靠门禁抓。
 *
 * 笔记源不在本仓库（稀疏检出），所以缺 manifest 时按 `it.skipIf` 跳过，
 * CI 里 REQUIRE_NOTES=1 让缺失直接失败（与 curriculum 的门禁同一套约定）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { NOTE_WIDGETS } from './widgets';

const MANIFEST = 'static/notes/manifest.json';
const hasManifest = existsSync(MANIFEST);
const requireNotes = process.env.REQUIRE_NOTES === '1';

type ManifestNote = { slug: string };
type Manifest = { modules: { sections: { notes: ManifestNote[] }[] }[] };

function allSlugs(): string[] {
	const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
	return m.modules.flatMap((mo) => mo.sections.flatMap((s) => s.notes.map((n) => n.slug)));
}

describe('笔记内嵌部件的注册表', () => {
	it('至少注册了一个部件（否则这套机制等于没接上）', () => {
		expect(Object.keys(NOTE_WIDGETS).length).toBeGreaterThan(0);
	});

	it('每篇的锚点标题两两不同（同一标题挂两个部件会叠在一起）', () => {
		for (const [slug, widgets] of Object.entries(NOTE_WIDGETS)) {
			const anchors = widgets.map((w) => w.afterHeading);
			expect(new Set(anchors).size, `${slug} 有重复锚点`).toBe(anchors.length);
		}
	});

	it('引导文案非空且不是占位符', () => {
		for (const [slug, widgets] of Object.entries(NOTE_WIDGETS)) {
			for (const w of widgets) {
				expect(w.invitation.trim().length, `${slug} 的引导文案为空`).toBeGreaterThan(10);
				expect(w.invitation).not.toMatch(/TODO|待补|占位/);
			}
		}
	});

	it.skipIf(!hasManifest && !requireNotes)('每个 slug 在 manifest 里真实存在', () => {
		const slugs = new Set(allSlugs());
		for (const slug of Object.keys(NOTE_WIDGETS)) {
			expect(slugs.has(slug), `manifest 里没有这篇笔记：${slug}`).toBe(true);
		}
	});

	it.skipIf(!hasManifest && !requireNotes)('每个锚点标题在对应笔记里真实是个标题', () => {
		for (const [slug, widgets] of Object.entries(NOTE_WIDGETS)) {
			const path = `static/notes/${slug}.md`;
			expect(existsSync(path), `找不到笔记文件：${path}`).toBe(true);
			const md = readFileSync(path, 'utf8');
			// 收集全部标题文本，逐个锚点核对
			const headings = [...md.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1]);
			for (const w of widgets) {
				const hit = headings.some((h) => h.includes(w.afterHeading));
				expect(hit, `${slug} 里没有标题包含「${w.afterHeading}」。笔记标题改了就要同步这里`).toBe(
					true
				);
			}
		}
	});
});
