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

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const SRC = 'node_modules/pyodide';
const DEST = 'static/pyodide';

/**
 * 运行所需的最小文件集。
 *
 * 刻意不复制整个目录：包里还有 .d.ts、source map、示例 HTML，
 * 加起来几百 KB 的无用产物。
 *
 * numpy 是唯一被显式纳入的科学计算包。原先这里写「科学计算包按需从 lock 文件里的
 * 地址取，目前的题目一个都没用到」——关卡题确实一个都没用，但笔记正文的可运行代码块
 * 用得很多：实测全站 578 个 python 块里，只靠标准库能跑出结果的仅 11 个，
 * 加上 numpy 后变成 71 个（10 篇 → 66 篇），解锁的正是 KV Cache 显存分析、量化、
 * 反向传播、CLIP 这类纯计算的推导型代码——最值得动手改一改再跑的那批。
 *
 * 不改成「从 CDN 按需取」的原因和 wasm 一样：实测 jsDelivr 在国内只有 24.9 KB/s，
 * 2.9 MB 要两分钟，用户会以为卡死了。同源托管是几秒。
 *
 * 它**不影响阅读路径的体积**：numpy 只在用户点了某个用 numpy 的块的「运行」时，
 * 由 loadPackage 单独拉取（AGENTS.md 第 12 条要求的严格懒加载依然成立）。
 */
const FILES = [
	'pyodide.mjs', // 入口胶水代码
	'pyodide.asm.mjs', // Emscripten 生成的运行时
	'pyodide.asm.wasm', // 解释器本体，9.6 MB
	'python_stdlib.zip', // Python 标准库，2.5 MB
	'pyodide-lock.json' // 包索引，loadPackage 用
];

/**
 * 额外按需同步的科学计算包。
 *
 * 这批 wheel **不在 npm 包里**——`pyodide` 的 package.json `files` 白名单只含核心
 * 运行时（asm/wasm/stdlib/lock），科学计算包设计上由 `loadPackage` 运行时从 CDN 取。
 * 所以这里必须下载，不能像核心文件那样从 node_modules 复制。
 *
 * 这个坑值得写下来：本地 `node_modules/pyodide/` 里可能**恰好**有 numpy wheel
 * （早先某次运行时下载留下的缓存），于是「从 node_modules 复制」在本地跑得通，
 * 到 CI 的全新安装就 `❌ 缺少必需文件`。本地绿、CI 红，症状指向环境，根因在实现。
 *
 * 文件名与校验值都**从 lock 文件解析**，不硬编码——硬编码在 numpy 升版后会变成
 * 「缺少必需文件」中断构建，或更糟：拿到旧 wheel 而 lock 指向新版本。
 */
const EXTRA_PACKAGES = ['numpy'];

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

	const lock = JSON.parse(await readFile(`${SRC}/pyodide-lock.json`, 'utf8'));

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

	// 科学计算包不在 npm 包里，必须下载。校验 sha256 后落盘
	const downloaded = await syncExtraPackages(lock, pkg.version);
	total += downloaded.bytes;
	copied += downloaded.count;

	const mb = (total / 1024 / 1024).toFixed(1);
	console.log(
		copied === 0
			? `✓ Pyodide ${pkg.version} 已就位（${mb} MB，无需更新）`
			: `✓ Pyodide ${pkg.version} 已复制/下载 ${copied} 个文件（${mb} MB）`
	);
}

/**
 * 下载 EXTRA_PACKAGES 声明的 wheel 到 static/pyodide/。
 *
 * 已存在且 sha256 匹配就跳过——既避免每次构建重复下载，也能在 numpy 升版后
 * 自动发现旧文件不匹配并重新拉取。只比大小是不够的：CDN 返回错误页面时
 * 大小当然也不同，但如果恰好命中一个大小相同的坏文件，只比大小就放过去了。
 */
async function syncExtraPackages(lock, version) {
	let bytes = 0;
	let count = 0;

	for (const name of EXTRA_PACKAGES) {
		const entry = lock.packages?.[name];
		if (!entry?.file_name) {
			console.error(`❌ lock 文件里找不到包 ${name}，无法同步`);
			process.exit(1);
		}
		if (!entry.sha256) {
			console.error(`❌ lock 文件里 ${name} 没有 sha256，无法校验下载结果`);
			process.exit(1);
		}

		const to = path.join(DEST, entry.file_name);

		if (existsSync(to)) {
			const existing = await readFile(to);
			if (sha256(existing) === entry.sha256) {
				bytes += existing.byteLength;
				continue;
			}
			console.log(`  ${name}: 本地文件与 lock 的 sha256 不符，重新下载`);
		}

		// 版本必须取自实际安装的 pyodide，不能写死——否则升版后会拉到不兼容的 wheel，
		// 而 ABI 不匹配的报错发生在浏览器里，极难联想到构建脚本
		const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${entry.file_name}`;
		console.log(`  下载 ${name} ${entry.version}…`);
		const res = await fetch(url);
		if (!res.ok) {
			console.error(`❌ 下载失败 ${url} → HTTP ${res.status}`);
			process.exit(1);
		}
		const buf = Buffer.from(await res.arrayBuffer());

		const got = sha256(buf);
		if (got !== entry.sha256) {
			console.error(`❌ ${name} 校验失败\n  期望 ${entry.sha256}\n  实际 ${got}`);
			process.exit(1);
		}

		await writeFile(to, buf);
		bytes += buf.byteLength;
		count += 1;
	}

	return { bytes, count };
}

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

await main();
