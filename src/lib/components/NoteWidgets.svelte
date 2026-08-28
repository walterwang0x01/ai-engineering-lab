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
	import { widgetsForNote, type NoteWidget } from '$lib/notes/widgets';

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
		Comp: Component | null;
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
			sectionEnd(heading as HTMLElement).insertAdjacentElement('afterend', host);
			found.push({ widget, host, Comp: null });
		}

		mounted = found;

		// 逐个懒加载。失败不影响正文阅读，只是少一个部件
		found.forEach(async (m, i) => {
			try {
				const mod = await m.widget.load();
				mounted[i].Comp = mod.default;
			} catch (e) {
				console.warn('[note-widget] 部件加载失败', e);
			}
		});
	});
</script>

{#each mounted as m (m.widget.afterHeading)}
	<div class="note-widget" use:mountInto={m.host}>
		<p class="nw-invitation">{m.widget.invitation}</p>
		{#if m.Comp}
			<m.Comp />
		{:else}
			<p class="nw-loading">正在载入…</p>
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

	.nw-loading {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--color-text-muted);
	}
</style>
