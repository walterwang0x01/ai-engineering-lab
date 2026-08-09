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
import { readFile, readdir, stat } from 'node:fs/promises';
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

	// ---------- 分享元数据 ----------
	// 缺了这些，分享到 X / 微信就是一条没有预览图的裸链接
	const meta = await page.evaluate(() => {
		const get = (sel) => document.querySelector(sel)?.getAttribute('content') ?? null;
		return {
			ogImage: get('meta[property="og:image"]'),
			ogUrl: get('meta[property="og:url"]'),
			twitterCard: get('meta[name="twitter:card"]'),
			canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
			favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null
		};
	});
	check('og:image 为绝对 URL 的 PNG', /^https:\/\/.+\.png$/.test(meta.ogImage ?? ''), meta.ogImage);
	check('twitter:card 为大图卡片', meta.twitterCard === 'summary_large_image', meta.twitterCard);
	check('canonical 已设置', /^https:\/\//.test(meta.canonical ?? ''), meta.canonical);
	check(
		'favicon 已替换（非 Svelte 默认 logo）',
		!(meta.favicon ?? '').includes('svelte-logo'),
		meta.favicon
	);

	// OG 图必须真实存在于产物中，否则抓取器拿不到图。
	// og:image 按规范是硬编码的线上绝对 URL，所以这里取文件名回到本地产物验证，
	// 避免冒烟测试依赖网络和线上部署状态。
	const ogFile = (meta.ogImage ?? '').split('/').pop();
	const ogRes = await fetch(`${BASE}/og/${ogFile}`);
	check('og:image 对应的图存在于产物中', ogRes.ok, `og/${ogFile} → HTTP ${ogRes.status}`);
	check(
		'OG 图是有效 PNG',
		ogRes.headers.get('content-type')?.includes('image/png') ?? false,
		ogRes.headers.get('content-type')
	);

	// ---------- 导航 ----------
	await page.locator('a.card').click();
	// SvelteKit 客户端路由是异步的，必须等 URL 真正变化而不是等网络空闲
	await page.waitForURL('**/kv-cache');
	check('导航到关卡页', page.url().endsWith('/kv-cache'), page.url());

	// .counter 只在 onMount 之后渲染，用它作为 hydration 完成的信号。
	// 少了这一步，后续点击会打在还没接管事件的静态 HTML 上。
	await page.waitForSelector('.counter');

	const levelOg = await page.evaluate(
		() => document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null
	);
	check('关卡页使用自己的 OG 图', (levelOg ?? '').endsWith('/kv-cache.png'), levelOg);

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
	check('答题队列已构建', /第 1 \/ 12 题/.test(counter), counter);

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
	check('答对的题熟练度升到 1', stored.records['kv-cache-01-gqa-baseline']?.box === 1);
	check('答错的题熟练度归零', stored.records['kv-cache-02-mha-contrast']?.box === 0);

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
	check('首页读取到关卡进度', badge === '2 / 12', badge);

	// ---------- 代码题（放最后：会消耗进度，不能影响前面的持久化断言） ----------
	// 只验证渲染与分派，不实际跑 Python：那要从 CDN 拉 10MB，
	// 在 CI 里既慢又依赖网络。真实执行由 lib/python/solutions.spec.ts 覆盖
	// （Node 下走本地 WASM，811ms 跑完）。
	await page.goto(`${BASE}/kv-cache`, { waitUntil: 'networkidle' });
	await page.waitForSelector('.counter');

	// 一路跳到代码题。前 10 道是数值/选择题
	let hops = 0;
	while ((await page.locator('[data-testid="code-editor"]').count()) === 0 && hops < 30) {
		const next = page.getByRole('button', { name: /下一题/ });
		if ((await next.count()) > 0) {
			await next.click();
			await page.waitForTimeout(100);
			hops += 1;
			continue;
		}
		// 当前题未定论：故意答错两次让它公布答案，从而出现「下一题」
		const input = page.locator('input[type=text]');
		if ((await input.count()) > 0) {
			await input.fill('-99999');
			await page.getByRole('button', { name: '提交' }).click();
			const retry = page.getByRole('button', { name: '再试一次' });
			if ((await retry.count()) > 0) {
				await retry.click();
				await input.fill('-88888');
				await page.getByRole('button', { name: '提交' }).click();
			}
		} else {
			await page.locator('.option').first().click();
			await page.getByRole('button', { name: '提交' }).click();
			const retry = page.getByRole('button', { name: '再试一次' });
			if ((await retry.count()) > 0) {
				await retry.click();
				await page.locator('.option').first().click();
				await page.getByRole('button', { name: '提交' }).click();
			}
		}
		hops += 1;
	}

	const reachedCode = (await page.locator('[data-testid="code-editor"]').count()) > 0;
	check('能从数值题走到代码题', reachedCode, `${hops} 步`);

	if (reachedCode) {
		check(
			'代码题说明了运行时体积与本地执行',
			(await page.getByText(/首次运行需要下载约 10 MB/).count()) === 1
		);
		check(
			'代码题不复用数值题的提交按钮（分派正确）',
			(await page.getByRole('button', { name: '提交' }).count()) === 0
		);

		// 编辑器是动态加载的，等它真正就绪
		await page.waitForSelector('.cm-content', { timeout: 30_000 });
		const starter = await page.locator('.cm-content').innerText();
		check(
			'起始代码抛 NotImplementedError 而非返回定值',
			starter.includes('NotImplementedError'),
			'防止比较型断言恒真'
		);

		// ---------- 真的跑一次 Python ----------
		// 同源托管后首次加载约 1-2 秒（走 CDN 时实测 24KB/s，要 6 分钟），
		// 所以这里可以真执行而不只是验证渲染。
		const t0 = Date.now();
		await page.getByRole('button', { name: '运行并检查' }).click();
		await page.waitForSelector('[data-testid="code-score"], .panel-bad, .panel-warn', {
			timeout: 120_000
		});
		const firstRunSec = ((Date.now() - t0) / 1000).toFixed(1);

		const loadFailed = (await page.locator('.panel-warn').count()) > 0;
		check(
			'Pyodide 同源加载成功',
			!loadFailed,
			loadFailed
				? (await page.locator('.panel-warn').innerText()).slice(0, 80)
				: `首次 ${firstRunSec}s`
		);

		if (!loadFailed) {
			const zeroScore = await page.locator('[data-testid="code-score"]').innerText();
			check('未实现时全部用例失败', /^0 \//.test(zeroScore.trim()), zeroScore.replace(/\n/g, ' '));
			const reasons = await page.locator('.case-message').allInnerTexts();
			check(
				'失败原因指向未实现而非断言不成立',
				reasons.some((r) => r.includes('NotImplementedError')),
				reasons[0]?.slice(0, 50)
			);

			// 填入正确实现，应当全过
			await page.locator('.cm-content').click();
			await page.keyboard.press('ControlOrMeta+A');
			await page.keyboard.type(
				'def kv_cache_bytes(batch, seq_len, layers, kv_heads, head_dim, dtype_bytes):\n' +
					'    return 2 * batch * seq_len * layers * kv_heads * head_dim * dtype_bytes'
			);
			await page.getByRole('button', { name: '运行并检查' }).click();
			await page.waitForSelector('.score-ok', { timeout: 60_000 });

			const fullScore = await page.locator('[data-testid="code-score"]').innerText();
			check('正确实现通过全部用例', /5 \/ 5/.test(fullScore), fullScore.replace(/\n/g, ' '));
			check('答对后展开推导', (await page.locator('.explanation').count()) === 1);
			check(
				'代码题进度写入 localStorage',
				await page.evaluate(() => {
					const raw = localStorage.getItem('ael-progress-v1');
					if (!raw) return false;
					return Object.keys(JSON.parse(raw).records ?? {}).some((k) => k.includes('-c1-'));
				})
			);
		}

		// 懒加载的实质检查：直接量产物文件，而不是靠 HTTP content-length
		// （dev server 常用 chunked 编码，拿不到长度，断言会形同虚设）。
		const html = await readFile('build/kv-cache.html', 'utf8');
		const referenced = [...html.matchAll(/(?:href|src)="[^"]*?(_app\/immutable\/[^"]+)"/g)].map(
			(m) => m[1]
		);
		let biggest = { file: '', bytes: 0 };
		for (const rel of new Set(referenced)) {
			try {
				const { size } = await stat(`build/${rel}`);
				if (size > biggest.bytes) biggest = { file: rel.split('/').pop() ?? rel, bytes: size };
			} catch {
				/* 引用了不存在的文件会在别处暴露 */
			}
		}
		check(
			'关卡页首屏引用的模块中无编辑器体量的块（懒加载生效）',
			biggest.bytes > 0 && biggest.bytes < 200_000,
			`${new Set(referenced).size} 个模块，最大 ${biggest.file} = ${biggest.bytes} B`
		);

		const allChunks = await readdir('build/_app/immutable/chunks');
		let lazyBig = 0;
		for (const f of allChunks) {
			const { size } = await stat(`build/_app/immutable/chunks/${f}`);
			if (size > lazyBig) lazyBig = size;
		}
		check(
			'编辑器已构建但仅按需加载',
			lazyBig > 200_000,
			`最大 chunk ${(lazyBig / 1024).toFixed(0)} KB，未被首屏引用`
		);

		// Pyodide 资源必须同源可达，否则用户会退化到 6 分钟的 CDN 路径
		const wasmRes = await fetch(`${BASE}/pyodide/pyodide.asm.wasm`);
		check(
			'Pyodide 同源资源可达',
			wasmRes.ok,
			`HTTP ${wasmRes.status}, ${((Number(wasmRes.headers.get('content-length')) || 0) / 1024 / 1024).toFixed(1)} MB`
		);
	}
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
