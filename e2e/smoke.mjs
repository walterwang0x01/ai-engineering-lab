/**
 * 全链路冒烟测试。
 *
 * 单元测试和组件测试覆盖不了的东西：真实构建产物在真实浏览器里
 * 是否真的能从「打开首页」一路走到「进度跨刷新保留」。
 *
 * 自己管理 preview 服务器的启停，一条命令跑完：
 *   pnpm run test:smoke
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

/**
 * 确认端口空闲。
 *
 * 必须做这一步：如果端口被上一次未清理的进程占着，
 * vite 会静默换到别的端口，而测试仍然连到旧进程 ——
 * 表现为诡异的 hydration 失败，排查起来极浪费时间。
 */
async function assertPortFree(port) {
	try {
		await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(800) });
	} catch {
		return; // 连不上 = 空闲，正常路径
	}
	throw new Error(`端口 ${port} 已被占用。先清理：lsof -ti:${port} | xargs kill -9`);
}

/** 轮询等待服务器就绪，避免固定 sleep 的脆弱性 */
async function waitForServer(url, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			/* 还没起来，继续等 */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`服务器在 ${timeoutMs}ms 内未就绪: ${url}`);
}

const failures = [];
function check(label, condition, detail = '') {
	const mark = condition ? '✅' : '❌';
	console.log(`${mark} ${label}${detail ? ` → ${detail}` : ''}`);
	if (!condition) failures.push(label);
}

await assertPortFree(PORT);

// 直接 spawn vite 而不是 `pnpm run preview`：少一层包装进程，kill 才能真正生效。
// --strictPort 保证端口冲突时直接失败，而不是悄悄换端口。
const server = spawn(
	'node_modules/.bin/vite',
	['preview', '--port', String(PORT), '--strictPort'],
	{ stdio: 'ignore' }
);

let browser;
try {
	await waitForServer(BASE);
	browser = await chromium.launch();
	const page = await browser.newPage();

	// ---------- 首页 ----------
	await page.goto(BASE, { waitUntil: 'networkidle' });
	const heading = await page.locator('h1').first().innerText();
	check('首页渲染', heading.includes('能动手验证'), heading.replace(/\n/g, ' '));
	check('关卡入口存在', (await page.locator('a.card').count()) === 1);

	// ---------- 导航 ----------
	await page.locator('a.card').click();
	// SvelteKit 客户端路由是异步的，必须等 URL 真正变化而不是等网络空闲
	await page.waitForURL('**/kv-cache');
	check('导航到关卡页', page.url().endsWith('/kv-cache'), page.url());

	// .counter 只在 onMount 之后渲染，用它作为 hydration 完成的信号。
	// 少了这一步，后续点击会打在还没接管事件的静态 HTML 上。
	await page.waitForSelector('.counter');

	// ---------- 沙盒关卡 ----------
	const memInit = await page.getByTestId('memory-value').innerText();
	check('默认 MHA+fp16 为 320 GB', memInit === '320 GB', memInit);

	await page.getByText('GQA 8', { exact: true }).click();
	await page.getByText('int8', { exact: true }).click();
	const mem = await page.getByTestId('memory-value').innerText();
	const quality = await page.getByTestId('quality-value').innerText();
	check('GQA8+int8 显存为 20 GB', mem === '20.0 GB', mem);
	check('对应质量损失 1.0%', quality === '1.0%', quality);
	check('关卡判定达标', (await page.locator('.status-ok').count()) === 1);

	// ---------- 答题：答对路径 ----------
	const counter = await page.locator('.counter').innerText();
	check('答题队列已构建', /第 1 \/ 10 题/.test(counter), counter);

	await page.locator('input[type=text]').fill('1');
	await page.getByRole('button', { name: '提交' }).click();
	await page.waitForSelector('.msg-ok');
	check('答对显示成功反馈', (await page.locator('.msg-ok').count()) === 1);
	check('答对展开推导', (await page.locator('.explanation').count()) === 1);

	// ---------- 答题：答错两次路径 ----------
	await page.getByRole('button', { name: /下一题/ }).click();
	await page.waitForFunction(() =>
		document.querySelector('.counter')?.textContent?.includes('第 2')
	);

	await page.locator('input[type=text]').fill('999');
	await page.getByRole('button', { name: '提交' }).click();
	await page.waitForSelector('.msg-bad');
	check('答错显示失败反馈', (await page.locator('.msg-bad').count()) === 1);
	check('第一次答错给提示', (await page.locator('.hint').count()) === 1);
	check('第一次答错不公布答案', (await page.locator('.explanation').count()) === 0);

	await page.getByRole('button', { name: '再试一次' }).click();
	await page.locator('input[type=text]').fill('888');
	await page.getByRole('button', { name: '提交' }).click();
	await page.waitForSelector('.correct-answer');
	check('第二次答错公布正确答案', (await page.locator('.correct-answer').count()) === 1);

	// ---------- 持久化 ----------
	const raw = await page.evaluate(() => localStorage.getItem('ael-progress-v1'));
	const stored = JSON.parse(raw ?? '{}');
	check('localStorage 已写入且版本正确', stored.version === 1);
	const ids = Object.keys(stored.records ?? {});
	check('记录了 2 道题', ids.length === 2, ids.join(', '));
	check('答对的题熟练度升到 1', stored.records['kv-01-gqa-baseline']?.box === 1);
	check('答错的题熟练度归零', stored.records['kv-02-mha-contrast']?.box === 0);

	// ---------- 跨刷新保留 ----------
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForSelector('.stats');
	const stats = await page.locator('.stats').innerText();
	check(
		'刷新后掌握度统计保留',
		/1 在学/.test(stats) && /1 需重练/.test(stats),
		stats.replace(/\n/g, ' | ')
	);
	check('刷新后连击归零（会话内设计）', (await page.locator('.stat-streak').count()) === 0);

	// ---------- 跨页面共享进度 ----------
	await page.goto(BASE, { waitUntil: 'networkidle' });
	await page.waitForSelector('.badge');
	const badge = await page.locator('.badge').first().innerText();
	check('首页读取到关卡进度', badge === '2 / 10', badge);
} finally {
	await browser?.close();
	// 等 SIGTERM 真正生效，否则下一次运行会撞上残留进程占用的端口
	if (server.exitCode === null) {
		server.kill('SIGTERM');
		await new Promise((resolve) => {
			const timer = setTimeout(() => {
				server.kill('SIGKILL');
				resolve();
			}, 3000);
			server.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});
	}
}

if (failures.length > 0) {
	console.log(`\n⚠️  ${failures.length} 项失败：${failures.join('; ')}`);
	process.exit(1);
}
console.log('\n🎉 全链路验证通过');
