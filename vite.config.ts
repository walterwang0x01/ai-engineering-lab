import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

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
			adapter: adapter({ fallback: '404.html' })
			// 不需要配 paths.base：SvelteKit 默认 paths.relative = true，
			// 产物里的链接和资源全是相对路径（./kv-cache、./_app/…），
			// 部署到 github.io/仓库名/ 这类子路径下自动正确。
			// 已验证：BASE_PATH 有无都生成同样的相对路径。
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
