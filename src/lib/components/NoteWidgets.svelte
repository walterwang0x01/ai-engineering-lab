<script lang="ts">
	/**
	 * 把可操纵部件插进笔记正文的指定小节之后。
	 *
	 * 与 `RunnableCode` 同一套渐进增强思路：正文由 `{@html}` 注入，
	 * 这里在渲染后的 DOM 里按标题文本找锚点，插挂载点，再把 Svelte 组件搬进去。
	 * 笔记源文件不用动。
	 */
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import type { InteractionSpec } from '$lib/interactions/types';
	import { widgetId, widgetsForNote, type NoteWidget } from '$lib/notes/widgets';
	import { interactionProgress } from '$lib/storage/interaction-progress.svelte';

	type Props = {
		/** 正文容器 */
		container: HTMLElement | null;
		/** 当前笔记 slug，用于查注册表 */
		slug: string;
	};

	let { container, slug }: Props = $props();

	type Mounted = {
		widget: NoteWidget;
		host: HTMLElement;
		LegacyComp: Component | null;
		HostComp: Component<{ spec: InteractionSpec }> | null;
		spec: InteractionSpec | null;
	};

	let mounted = $state<Mounted[]>([]);

	/**
	 * Svelte action：把节点搬进 `{@html}` 渲染出的挂载点。
	 * 节点仍归 Svelte 所有，响应式与事件照常工作，只是物理位置在正文流里。
	 */
	function mountInto(node: HTMLElement, target: HTMLElement) {
		target.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	/**
	 * 找到锚点标题所属小节的末尾。
	 *
	 * 「小节末尾」= 下一个**同级或更高级**标题之前。用级别比较而不是「下一个任意标题」：
	 * 锚在 h2 上时，它的 h3 子节仍属于这一节，部件应该放在整节讲完之后。
	 */
	function sectionEnd(heading: HTMLElement): Element {
		const level = Number(heading.tagName.slice(1));
		let last: Element = heading;
		let node = heading.nextElementSibling;
		while (node) {
			const m = /^H([1-6])$/.exec(node.tagName);
			if (m && Number(m[1]) <= level) break;
			last = node;
			node = node.nextElementSibling;
		}
		return last;
	}

	onMount(() => {
		if (!container) return;
		const widgets = widgetsForNote(slug);
		if (widgets.length === 0) return;

		interactionProgress.load();
		let active = true;

		/*
		 * 旧 5 个沙盒不知道新的进度存储，也不该为了记录行为去改每个组件。
		 * 在正文容器上委托 input/change 事件，找到所属 note-widget 的稳定 id 后记录。
		 * 新 InteractionHost 也会在这里被记录；它自己额外记录 preset 使用情况。
		 */
		const recordInteraction = (event: Event) => {
			const target = event.target as Element | null;
			const wrapper = target?.closest<HTMLElement>('.note-widget[data-interaction]');
			const id = wrapper?.dataset.interaction;
			if (id) interactionProgress.record(id);
		};
		container.addEventListener('input', recordInteraction);
		container.addEventListener('change', recordInteraction);

		const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')];
		const found: Mounted[] = [];

		for (const widget of widgets) {
			// 标题文本可能带锚点链接等附加内容，用 includes 而不是全等
			const heading = headings.find((h) =>
				(h.textContent ?? '').trim().includes(widget.afterHeading)
			);
			if (!heading) {
				// 显式失效而不是静默错位：作者改了标题就该知道映射要更新
				console.warn(`[note-widget] 找不到锚点标题「${widget.afterHeading}」，跳过（${slug}）`);
				continue;
			}
			const host = document.createElement('div');
			host.className = 'note-widget-host';
			/*
			 * 阅读页在 SSR HTML 中先输出同名占位锚点，让 SvelteKit 预渲染爬虫能验证 href。
			 * 客户端找到真实插入位置后，把 id 从页首占位转移到这里。不能用
			 * handleMissingId 忽略——那会让真正拼错的交互 id 也静默通过构建。
			 */
			const anchorId = `interaction-${widgetId(widget)}`;
			document.getElementById(anchorId)?.removeAttribute('id');
			host.id = anchorId;
			sectionEnd(heading as HTMLElement).insertAdjacentElement('afterend', host);
			found.push({ widget, host, LegacyComp: null, HostComp: null, spec: null });

			// 带 hash 直达时，浏览器在 hydration 前只能滚到页首占位；id 转移后重滚到真实实验。
			if (decodeURIComponent(location.hash) === `#${anchorId}`) {
				requestAnimationFrame(() => host.scrollIntoView({ block: 'start' }));
			}
		}

		mounted = found;

		/*
		 * 两类部件都按需加载：旧沙盒加载自己的组件；声明式规格只在真正出现时
		 * 加载统一 InteractionHost。158 篇没有新声明式实验的笔记不为渲染器付首包成本。
		 */
		found.forEach(async (m, i) => {
			try {
				if (m.widget.loadSpec) {
					const [spec, mod] = await Promise.all([
						m.widget.loadSpec(),
						import('$lib/interactions/InteractionHost.svelte')
					]);
					if (!active || !mounted[i]) return;
					mounted[i].spec = spec;
					mounted[i].HostComp = mod.default;
				} else if (m.widget.load) {
					const mod = await m.widget.load();
					if (!active || !mounted[i]) return;
					mounted[i].LegacyComp = mod.default;
				}
			} catch (e) {
				if (active) console.warn('[note-widget] 部件加载失败', e);
			}
		});

		return () => {
			active = false;
			container.removeEventListener('input', recordInteraction);
			container.removeEventListener('change', recordInteraction);
			for (const item of found) item.host.remove();
			mounted = [];
		};
	});
</script>

{#each mounted as m (widgetId(m.widget))}
	<div
		class="note-widget"
		id={`interaction-content-${widgetId(m.widget)}`}
		use:mountInto={m.host}
		data-interaction={widgetId(m.widget)}
	>
		<p class="nw-invitation">{m.widget.invitation}</p>
		{#if m.HostComp && m.spec}
			<m.HostComp spec={m.spec} />
		{:else if m.LegacyComp}
			<m.LegacyComp />
		{:else if m.widget.load || m.widget.loadSpec}
			<p class="nw-loading">正在载入…</p>
		{:else}
			<p class="nw-error">交互配置不完整，正文阅读不受影响。</p>
		{/if}
	</div>
{/each}

<style>
	.note-widget {
		margin: var(--space-6) 0;
		padding: var(--space-5);
		background: var(--color-surface-raised);
		/*
		 * 曾经写的是 `var(--color-border)` —— 而那个 token **从未被定义过**
		 * （设计系统里只有 -subtle 和 -strong）。CSS 引用未定义变量会让整条声明
		 * 失效，所以这些嵌在笔记正文里的部件一直**没有边框**：白卡片浮在白页面上，
		 * 读者看不出「这一块是可操纵的部件」的边界。静默失效，构建和 check 都是绿的。
		 */
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
	}

	.nw-invitation {
		margin: 0 0 var(--space-4);
		font-size: var(--fs-base);
		line-height: 1.75;
		color: var(--color-text-soft);
	}

	.nw-loading,
	.nw-error {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
	}

	.nw-error {
		color: var(--color-bad-text);
	}
</style>
