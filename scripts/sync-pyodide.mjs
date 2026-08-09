/**
 * 把 Pyodide 运行时从 node_modules 复制到 static/pyodide/，实现**同源托管**。
 *
 * 为什么不用 CDN：
 * 实测 jsDelivr 上 9.6MB 的 pyodide.asm.wasm 下载速度只有 24.9 KB/s，
 * 需要 6.4 分钟——对国内网络这是常态，不是异常。用户根本等不到。
 * 同源托管后走站点自己的 CDN，能打开站点就能加载运行时。
 *
 * 体积代价：约 12 MB。GitHub Pages 的站点上限是 1 GB，占 1.2%，可以接受。
 *
 * 产物不进 git（见 .gitignore），每次 dev 和 build 前自动复制，
 * 这样版本永远和 package.json 里的 pyodide 一致，不会出现
 * 「JS 胶水是新版、WASM 是旧版」这种极难排查的错。
 */

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC = 'node_modules/pyodide';
const DEST = 'static/pyodide';

/**
 * 运行所需的最小文件集。
 *
 * 刻意不复制整个目录：包里还有 .d.ts、source map、示例 HTML，
 * 加起来几百 KB 的无用产物。科学计算包（numpy 等）也不在这里——
 * 它们按需从 lock 文件里的地址取，目前的题目一个都没用到。
 */
const FILES = [
	'pyodide.mjs', // 入口胶水代码
	'pyodide.asm.mjs', // Emscripten 生成的运行时
	'pyodide.asm.wasm', // 解释器本体，9.6 MB
	'python_stdlib.zip', // Python 标准库，2.5 MB
	'pyodide-lock.json' // 包索引，loadPackage 用
];

async function main() {
	if (!existsSync(SRC)) {
		console.error(`❌ 找不到 ${SRC}，先跑 pnpm install`);
		process.exit(1);
	}

	// 校验版本一致性：胶水代码和 WASM 版本不匹配会在初始化时报难懂的错
	const pkg = JSON.parse(await readFile(`${SRC}/package.json`, 'utf8'));
	const rootPkg = JSON.parse(await readFile('package.json', 'utf8'));
	const declared = (rootPkg.dependencies?.pyodide ?? '').replace(/^[\^~]/, '');
	if (declared && declared !== pkg.version) {
		console.error(`❌ 版本不一致：package.json 声明 ${declared}，实际安装 ${pkg.version}`);
		process.exit(1);
	}

	await mkdir(DEST, { recursive: true });

	let total = 0;
	let copied = 0;
	for (const file of FILES) {
		const from = path.join(SRC, file);
		const to = path.join(DEST, file);

		if (!existsSync(from)) {
			console.error(`❌ 缺少必需文件 ${from}`);
			process.exit(1);
		}

		const { size } = await stat(from);
		total += size;

		// 已存在且大小相同就跳过，避免每次 dev 都重复复制 12MB
		if (existsSync(to)) {
			const existing = await stat(to);
			if (existing.size === size) continue;
		}

		await copyFile(from, to);
		copied += 1;
	}

	const mb = (total / 1024 / 1024).toFixed(1);
	console.log(
		copied === 0
			? `✓ Pyodide ${pkg.version} 已就位（${mb} MB，无需更新）`
			: `✓ Pyodide ${pkg.version} 已复制 ${copied} 个文件（${mb} MB）`
	);
}

await main();
