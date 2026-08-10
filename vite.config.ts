import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * 部署子路径。空串表示部署在域名根上。
 *
 * SvelteKit 要求 base 为空串或以 `/` 开头，所以这里做一次规范化而不是直接
 * 把环境变量塞进去——写错成 `ai-engineering-lab`（漏了斜杠）会在构建时就报出来，
 * 而不是等到线上深层路由白屏。
 */
function resolveBasePath(): '' | `/${string}` {
	const raw = (process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
	if (raw === '') return '';
	if (!raw.startsWith('/')) {
		throw new Error(`BASE_PATH 必须以 "/" 开头，实际是 ${JSON.stringify(process.env.BASE_PATH)}`);
	}
	return raw as `/${string}`;
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// fallback 让未预渲染的路由（笔记阅读页 ssr=false）由客户端路由接管。
			// 选 404.html 是因为 GitHub Pages 在找不到文件时正是返回它，
			// 于是 /notes/任意/路径 会命中 fallback，客户端路由再渲染正确内容。
			// 没有它 adapter-static 会因为「遇到动态路由」直接构建失败。
			adapter: adapter({ fallback: '404.html' }),

			// ⚠️ 子路径部署**必须**设 base，尽管 paths.relative 默认为 true。
			//
			// 相对路径只对**预渲染页**成立：index.html / notes.html / kv-cache.html
			// 里是 ./_app/…，放在任何前缀下都对。
			//
			// 但 SPA fallback（404.html）不一样：它会被 GitHub Pages 从**任意深度**返回，
			// 相对路径在 /notes/a/b 这种深度下会解析错，所以 SvelteKit 给它发的是
			// 根绝对路径 /_app/…。base 为空时那就指向域名根 ——
			// 站点在 /ai-engineering-lab/ 下，于是 fallback 页一个 JS 都加载不到，
			// 客户端路由永不启动，168 篇笔记的直连/刷新/分享链接全部白屏。
			//
			// 这是线上实测抓到的缺陷（本地 vite preview 服务在域名根上，永远复现不出来）。
			// scripts/assert-fallback-base.mjs 在每次 build 后校验这个不变量。
			paths: { base: resolveBasePath() }
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
