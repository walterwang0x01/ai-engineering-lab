#!/usr/bin/env node
/**
 * 构建后门禁：SPA fallback 的资源前缀必须与 BASE_PATH 一致。
 *
 * ## 为什么需要这道单独的检查
 *
 * 这个缺陷是线上实测抓到的，而**本地冒烟测试在结构上不可能发现它**：
 * `vite preview` 把站点服务在域名根上，`/_app/…` 这种根绝对路径永远解析正确；
 * 只有真正部署到 `github.io/仓库名/` 子路径下才会暴露。
 *
 * 症状极具误导性：首页、`/notes`、关卡页全都正常（它们是预渲染页，用的是
 * 相对路径 `./_app/…`），只有未预渲染的深层路由白屏 —— 因为 fallback 页
 * 加载不到任何 JS，客户端路由根本没启动。表面上像是「路由坏了」，
 * 实际是资源前缀错了。
 *
 * 所以这里直接对产物断言，跑在每次 build 之后，CI 和部署都覆盖。
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const FALLBACK = path.join('build', '404.html');
const base = process.env.BASE_PATH ?? '';

if (!existsSync(FALLBACK)) {
	console.error(`❌ 找不到 ${FALLBACK}。adapter-static 的 fallback 配置被改动了？`);
	process.exit(1);
}

const html = readFileSync(FALLBACK, 'utf8');
const refs = [...html.matchAll(/(?:href|src)="([^"]*_app\/[^"]+)"/g)].map((m) => m[1]);

if (refs.length === 0) {
	console.error(`❌ ${FALLBACK} 里没有任何 _app 资源引用，客户端路由不可能启动。`);
	process.exit(1);
}

/** fallback 会被从任意深度返回，所以它的资源引用必须是绝对路径 + 正确前缀 */
const expectedPrefix = `${base}/_app/`;
const wrong = refs.filter((r) => !r.startsWith(expectedPrefix));

if (wrong.length > 0) {
	console.error(
		`❌ ${FALLBACK} 的资源前缀不对。\n` +
			`   期望以 "${expectedPrefix}" 开头（BASE_PATH=${JSON.stringify(base)}）\n` +
			`   实际有 ${wrong.length} 处不符，例如：${wrong[0]}\n` +
			`   后果：站点部署在子路径下时，深层路由（如 /notes/<slug>）会白屏——\n` +
			`   fallback 页加载不到 JS，客户端路由不会启动。\n` +
			`   修法：部署到子路径时把 BASE_PATH 设成该子路径（见 .github/workflows/deploy.yml）。`
	);
	process.exit(1);
}

// 相对路径出现在 fallback 里同样是错的：它在 /a/b 这种深度会解析到错的位置
const relative = refs.filter((r) => r.startsWith('./') || r.startsWith('../'));
if (relative.length > 0) {
	console.error(`❌ ${FALLBACK} 含相对路径资源引用，深层路由下会解析错：${relative[0]}`);
	process.exit(1);
}

console.log(
	`✅ fallback 资源前缀正确：${refs.length} 处引用均以 "${expectedPrefix}" 开头` +
		(base === '' ? '（根部署）' : `（子路径部署 ${base}）`)
);
