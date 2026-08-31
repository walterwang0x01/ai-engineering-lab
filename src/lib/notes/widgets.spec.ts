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
import { NOTE_WIDGETS, widgetId } from './widgets';

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

	it('每个部件必须且只能选择旧组件或声明式规格之一', () => {
		for (const [slug, widgets] of Object.entries(NOTE_WIDGETS)) {
			for (const w of widgets) {
				const count = Number(Boolean(w.load)) + Number(Boolean(w.loadSpec));
				expect(count, `${slug} / ${w.afterHeading} 必须在 load 与 loadSpec 中二选一`).toBe(1);
			}
		}
	});

	it('每个交互都有全站唯一的稳定 id', () => {
		const seen = new Set<string>();
		for (const [slug, widgets] of Object.entries(NOTE_WIDGETS)) {
			for (const widget of widgets) {
				const id = widgetId(widget);
				expect(id).toMatch(/^[a-z0-9][a-z0-9-]+$/);
				expect(seen.has(id), `交互 id 重复：${id}（${slug}）`).toBe(false);
				seen.add(id);
			}
		}
	});

	it('声明式规格的参数、预设和默认输出全部合法', async () => {
		for (const [slug, widgets] of Object.entries(NOTE_WIDGETS)) {
			for (const w of widgets) {
				if (!w.loadSpec) continue;
				const spec = await w.loadSpec();
				expect(spec.id, `${slug} 的轻量 id 与懒加载规格不一致`).toBe(widgetId(w));
				expect(spec.parameters.length, `${spec.id} 没有参数`).toBeGreaterThan(0);

				const parameterIds = new Set(spec.parameters.map((p) => p.id));
				expect(parameterIds.size, `${spec.id} 参数 id 重复`).toBe(spec.parameters.length);
				for (const p of spec.parameters) {
					expect(p.min, `${spec.id}.${p.id} min >= max`).toBeLessThan(p.max);
					expect(p.step, `${spec.id}.${p.id} step 必须 > 0`).toBeGreaterThan(0);
					expect(p.defaultValue, `${spec.id}.${p.id} 默认值越界`).toBeGreaterThanOrEqual(p.min);
					expect(p.defaultValue, `${spec.id}.${p.id} 默认值越界`).toBeLessThanOrEqual(p.max);
				}

				for (const preset of spec.presets) {
					for (const [id, value] of Object.entries(preset.values)) {
						expect(parameterIds.has(id), `${spec.id}.${preset.id} 引用了未知参数 ${id}`).toBe(true);
						const parameter = spec.parameters.find((p) => p.id === id)!;
						expect(value, `${spec.id}.${preset.id}.${id} 越界`).toBeGreaterThanOrEqual(
							parameter.min
						);
						expect(value, `${spec.id}.${preset.id}.${id} 越界`).toBeLessThanOrEqual(parameter.max);
					}
				}

				const defaults = Object.fromEntries(spec.parameters.map((p) => [p.id, p.defaultValue]));
				const scenarios: readonly (readonly [string, Readonly<Record<string, number>>])[] = [
					['default', defaults],
					...spec.presets.map((preset) => [preset.id, { ...defaults, ...preset.values }] as const),
					['all-min', Object.fromEntries(spec.parameters.map((p) => [p.id, p.min]))],
					['all-max', Object.fromEntries(spec.parameters.map((p) => [p.id, p.max]))]
				];

				for (const [scenario, values] of scenarios) {
					const result = spec.evaluate(values);
					expect(result.metrics.length, `${spec.id}/${scenario} 没有输出指标`).toBeGreaterThan(0);
					for (const metric of result.metrics) {
						expect(
							Number.isFinite(metric.value),
							`${spec.id}/${scenario}.${metric.label} 不是有限数`
						).toBe(true);
					}
					for (const bar of result.bars ?? []) {
						expect(
							Number.isFinite(bar.value),
							`${spec.id}/${scenario}.${bar.label} bar value 非有限数`
						).toBe(true);
						expect(bar.max, `${spec.id}/${scenario}.${bar.label} bar max 必须 > 0`).toBeGreaterThan(
							0
						);
					}
					for (const item of result.ranking ?? []) {
						expect(
							Number.isFinite(item.score),
							`${spec.id}/${scenario}.${item.label} score 非有限数`
						).toBe(true);
					}
					expect(
						result.conclusion.trim().length,
						`${spec.id}/${scenario} 没有结论`
					).toBeGreaterThan(20);
				}
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
