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
import { existsSync } from 'node:fs';
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
	// 期望的关卡数从产物推断（每个关卡预渲染一个 html），
	// 这样新增关卡不需要改测试 —— 硬编码数字的断言每次都要跟着改，太脆弱。
	// 非关卡页面要排除：清单很短且变化很低频，新增时测试会失败提醒。
	const NON_LEVEL_PAGES = new Set(['index.html', '404.html', 'notes.html', 'levels.html']);
	const builtPages = (await readdir('build')).filter(
		(f) => f.endsWith('.html') && !NON_LEVEL_PAGES.has(f)
	);
	const cardCount = await page.locator('a.card').count();
	check(
		'首页卡片数与预渲染的关卡数一致',
		cardCount === builtPages.length && cardCount > 0,
		`${cardCount} 张卡片 / ${builtPages.length} 个关卡页`
	);
	check(
		'每张卡片都指向真实关卡（无孤儿页面）',
		await page.evaluate(async () => {
			const hrefs = [...document.querySelectorAll('a.card')].map((a) => a.getAttribute('href'));
			const results = await Promise.all(hrefs.map((h) => fetch(h).then((r) => r.ok)));
			return results.every(Boolean);
		})
	);

	// ---------- 顶栏当前页指示 ----------
	// 断言「恰好一个导航项被点亮，且是正确那一个」。
	//
	// 注意这个断言**测不出**子路径部署的问题：冒烟跑的是根路径构建，
	// 线上是 /ai-engineering-lab 子路径。那部分由 src/lib/nav/current.spec.ts
	// 用 route.id 覆盖（route.id 对部署位置免疫，当初就是为了不再依赖 URL
	// 才换过去的）。这里守住的是「特性整体没被改坏/删掉」，两者不重复。
	const levelSlug = builtPages[0]?.replace(/\.html$/, '');
	const navExpectations = [
		['/', 'nav-path'],
		['/levels', 'nav-levels'],
		['/notes', 'nav-notes'],
		// 关卡正文挂在根路径（/backprop），也必须算在「关卡」这条线下 ——
		// 不归并的话从 /levels 点进关卡后高亮就消失了
		...(levelSlug ? [[`/${levelSlug}`, 'nav-levels']] : [])
	];
	for (const [path, expected] of navExpectations) {
		await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
		const active = await page.$$eval('[data-testid^="nav-"][aria-current="page"]', (els) =>
			els.map((el) => el.dataset.testid)
		);
		check(
			`顶栏当前页指示：${path} → ${expected}`,
			active.length === 1 && active[0] === expected,
			`实际 ${active.length ? active.join(',') : '(无)'}`
		);
	}

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
	// 点击第一张卡片，验证客户端路由；随后统一直达 kv-cache 做后续断言，
	// 这样卡片顺序调整不会让测试失效
	// 关卡 id 从产物推断，不硬编码 —— 调整关卡顺序不该让测试失效
	const levelIds = builtPages.map((f) => f.replace(/\.html$/, ''));
	const anyLevel = new RegExp(`/(${levelIds.join('|')})$`);

	// 关卡索引页。导航里的「关卡」原来指向首页本身，点了页面不变，
	// 零上下文复查者的第一反应是「链接坏了」；而且全站没有关卡索引，
	// 5 个关卡只能在学习路径里散着找。
	await page.getByTestId('nav-levels').click();
	await page.waitForURL(/\/levels$/);
	const indexCards = await page.locator('[data-testid="level-index"] a.card').count();
	check('关卡索引页列出全部关卡', indexCards === builtPages.length, `${indexCards} 张`);
	check('索引页标出哪些关卡有代码题', (await page.locator('.fact-code').count()) > 0);
	// 间隔重复承诺了复习，但改版前全站没有任何「今天该复习什么」的入口，
	// dueAt 一直只存在 localStorage 里，用户看不到——复查里唯一的功能缺口
	check(
		'索引页有复习面板（首次访问时说明还没有到期的题）',
		(await page.getByTestId('review-panel').count()) <= 1,
		'无进度时不渲染，有进度时出现'
	);

	await page.goto(BASE, { waitUntil: 'networkidle' });
	check('首页有主 CTA', (await page.getByTestId('cta-levels').count()) === 1);

	// 全站导航。/notes 曾经是孤儿页面：部署好了、返回 200，但站内没有任何链接指向它，
	// 只能手输 URL 才能进去。这条断言让那个缺陷不能悄悄复发。
	await page.getByTestId('nav-notes').click();
	await page.waitForURL(/\/notes$/);
	check('首页可从导航点达笔记库', /\/notes$/.test(page.url()), page.url());

	await page.goto(BASE, { waitUntil: 'networkidle' });
	await page.locator('a.card').first().click();
	await page.waitForURL(anyLevel);
	check('点击卡片能进入关卡页', anyLevel.test(page.url()), page.url());

	await page.goto(`${BASE}/kv-cache`, { waitUntil: 'networkidle' });
	check('直达 kv-cache 路径可用（URL 未因重构而改变）', page.url().endsWith('/kv-cache'));

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
	// 方案 A 用进度环 + 分段进度条取代了原来的 .badge 徽章，
	// 所以这里改断言那两处：关卡行的 CTA 从「开始」变「继续」，模块图例出现在学/需重练。
	await page.goto(BASE, { waitUntil: 'networkidle' });
	await page.waitForSelector('[data-testid="module-bar"]');
	const ctas = await page.locator('a.lv .lv-go').allInnerTexts();
	check(
		'首页关卡行反映出已开始做题（开始 → 继续）',
		ctas.some((t) => t.includes('继续')),
		ctas.join(' | ')
	);
	const legends = await page.getByTestId('module-legend').allInnerTexts();
	check(
		'首页模块进度反映出 kv-cache 的作答',
		legends.some((t) => t.includes('在学') && t.includes('需重练')),
		legends.find((t) => t.includes('在学')) ?? legends.join(' | ')
	);

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

	// ---------- 笔记库 ----------
	// 笔记正文来自另一个仓库。它不存在时 sync 脚本会生成空 manifest，
	// 这是合法状态（别人 clone 本仓库时就是这样），不该让冒烟测试崩掉。
	// 注意不能只靠 fetch 判断：manifest 缺失时 fallback 会返回 404.html，
	// JSON.parse 直接抛 SyntaxError —— 这正是 CI 上第一次失败的原因。
	// 判断依据是「有多少篇」而不是「文件是否存在」：
	// 笔记仓库缺失时 sync 脚本仍会生成一份 count 为 0 的空 manifest，
	// 只看文件存在会把这种情况误判为已同步。
	const localManifest = existsSync('build/notes/manifest.json')
		? JSON.parse(await readFile('build/notes/manifest.json', 'utf8'))
		: { count: 0 };
	const notesSynced = (localManifest.count ?? 0) > 0;
	if (!notesSynced) {
		// 本地没有笔记仓库时跳过是便利，在 CI 里必须是硬失败。
		// 否则「构建脚本漏了 notes:sync」这类缺陷会让 CI 显绿而线上 404 ——
		// 这正是第一次部署后 manifest.json 返回 404 的原因。
		if (process.env.CI) {
			check(
				'CI 中笔记数据必须已同步',
				false,
				`manifest.count = ${localManifest.count ?? 0}，检查 assets:sync 是否包含 notes:sync、NOTES_SRC 是否正确`
			);
		} else {
			console.log('⏭️  笔记数据未同步，跳过笔记库验证（设置 NOTES_SRC 后可完整验证）');
		}
	}

	if (notesSynced) {
		const manifest = await (await fetch(`${BASE}/notes/manifest.json`)).json();
		check('笔记 manifest 可达且有内容', manifest.count > 100, `${manifest.count} 篇`);
		check(
			'笔记按模块分组',
			Array.isArray(manifest.modules) && manifest.modules.length > 1,
			`${manifest.modules?.length ?? 0} 个模块`
		);

		const quiz = await (await fetch(`${BASE}/notes/quiz.json`)).json();
		check(
			'自测题已提取',
			quiz.total > 100,
			`${quiz.total} 道 / ${Object.keys(quiz.items).length} 篇`
		);

		// 首页必须呈现完整的学习路径骨架，而不只是 5 个关卡。
		// 篇目本身不在首页展开（168 个链接会淹掉关卡），所以断言的是模块骨架。
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-testid="path-module"]');
		const pathModules = await page.locator('[data-testid="path-module"]').count();
		check(
			'首页渲染学习路径的模块骨架',
			pathModules === manifest.modules.length && pathModules > 1,
			`${pathModules} 个模块 / manifest ${manifest.modules.length} 个`
		);
		// 章节默认折叠到每模块 6 个（24 个 chip 挤成灰块是改版前的问题之一），
		// 所以这里断言的是折叠行为本身，而不是一个会随内容漂移的总数
		const chipCount = await page.locator('.chip-label').count();
		const moreButtons = await page.locator('.chip-more').count();
		check(
			'首页列出各模块的章节（默认折叠）',
			chipCount > 0 && moreButtons > 0,
			`${chipCount} 个 chip / ${moreButtons} 个折叠按钮`
		);

		await page.locator('.chip-more').first().click();
		const expandedCount = await page.locator('.chip-label').count();
		check(
			'点开折叠按钮后章节全部展开',
			expandedCount > chipCount,
			`${chipCount} → ${expandedCount}`
		);

		// 进度可视化：分段条 + 图例
		check('首页渲染模块进度条', (await page.locator('[data-testid="module-bar"]').count()) > 0);
		const legend = await page.getByTestId('module-legend').first().innerText();
		check('进度图例说明各档题数', /道(已掌握|在学|未做|需重练)/.test(legend), legend);

		await page.goto(`${BASE}/notes`, { waitUntil: 'networkidle' });

		// ---------- 笔记库：路线视图 ----------
		// 默认视图是「学习路线」——27 篇主线按阶段排成序列，
		// 不是 168 篇扑面而来的平铺列表
		await page.waitForSelector('[data-testid="path-stages"]');
		const pathSteps = await page.locator('[data-testid="path-step"]').count();
		check('笔记库默认展示学习路线（27 篇主线）', pathSteps === 27, `${pathSteps} 个 step`);
		const pathStages = await page.locator('.path-stage').count();
		check('路线分 5 个阶段', pathStages === 5, `${pathStages} 个阶段`);

		// 切到目录视图，继续测原有的模块折叠 / 搜索 / 筛选
		await page.getByTestId('view-catalog').click();
		await page.waitForSelector('a.note-link');
		// 列表页默认只展开第一个模块（168 篇全平铺是 12.3 屏，新用户复查里的严重度 3）
		const shownFirst = await page.locator('a.note-link:visible').count();
		const toggles = await page.locator('.mod-toggle').count();
		check(
			'笔记库按模块折叠',
			shownFirst > 0 && toggles === 5,
			`首屏 ${shownFirst} 篇 / ${toggles} 个模块开关`
		);
		const collapsed = await page.locator('.mod-toggle[aria-expanded="false"]').count();
		check(
			'折叠状态通过 aria-expanded 暴露给辅助技术',
			collapsed === toggles - 1,
			`${collapsed} 个收起`
		);

		await page.locator('.mod-toggle[aria-expanded="false"]').first().click();
		const afterExpand = await page.locator('a.note-link:visible').count();
		check('展开模块后出现更多篇目', afterExpand > shownFirst, `${shownFirst} → ${afterExpand}`);

		// 搜索与筛选：168 篇原来既无搜索也无筛选，一个模块 105 篇展开就是一面墙
		await page.getByTestId('notes-search').fill('注意力');
		await page.waitForTimeout(200);
		const searched = await page.locator('a.note-link:visible').count();
		check('搜索能过滤篇目', searched > 0 && searched < 20, `${searched} 篇命中`);
		await page.getByTestId('notes-search').fill('');
		await page.getByTestId('only-gradable').check();
		await page.waitForTimeout(200);
		const gradableOnly = await page.locator('a.note-link:visible').count();
		check('「只看有可判定题的」筛选生效', gradableOnly >= 4, `${gradableOnly} 篇`);
		await page.getByTestId('only-gradable').uncheck();

		// 有 Tier A 题的篇目必须在列表上可发现（复查严重度 3：此前完全没有标记）
		check(
			'列表标出哪些篇目有可判定题',
			(await page.locator('[data-testid="note-has-gradable"]').count()) > 0
		);

		// 交互发现入口：做了部件但用户找不到，等于没做。
		await page.getByTestId('only-interactive').check();
		await page.waitForTimeout(200);
		const interactiveOnly = await page.locator('a.note-link:visible').count();
		const interactionBadges = await page
			.locator('[data-testid="note-has-interaction"]:visible')
			.count();
		check(
			'「只看可交互的」筛选只留下带实验徽章的笔记',
			interactiveOnly >= 10 && interactionBadges === interactiveOnly,
			`${interactiveOnly} 篇 / ${interactionBadges} 个徽章`
		);

		// 声明式实验的完整路径：索引发现 → 阅读页跳转 → 按需加载 → 预设改变结果。
		await page.getByTestId('notes-search').fill('模型合并');
		await page.waitForTimeout(200);
		const modelMerge = page.locator('a.note-link:visible').first();
		check('模型合并实验可从索引筛选找到', (await modelMerge.count()) === 1);
		await modelMerge.click();
		await page.waitForSelector('[data-testid="jump-to-interaction"]', { timeout: 20_000 });
		await page.getByTestId('jump-to-interaction').click();
		await page.waitForSelector('[data-interaction="model-merge-tradeoff"]', { timeout: 20_000 });
		const interaction = page.locator('[data-interaction="model-merge-tradeoff"]');
		const beforeMetric = await interaction.locator('.metric-value').first().innerText();
		await interaction.getByRole('button', { name: '激进叠加' }).click();
		await page.waitForTimeout(200);
		const afterMetric = await interaction.locator('.metric-value').first().innerText();
		check(
			'声明式实验预设会改变可见指标',
			beforeMetric !== afterMetric,
			`${beforeMetric} → ${afterMetric}`
		);

		// 回到干净的笔记索引继续通用阅读页验证。
		await page.goto(`${BASE}/notes`, { waitUntil: 'networkidle' });
		// 默认视图是「学习路线」，需切到目录视图才能拿到 a.note-link 列表
		await page.getByTestId('view-catalog').click();
		await page.waitForSelector('a.note-link');

		// 点进第一篇，验证客户端渲染真的产出正文
		const firstNote = page.locator('a.note-link').first();
		const noteHref = await firstNote.getAttribute('href');
		await firstNote.click();
		await page.waitForSelector('[data-testid="note-body"] p', { timeout: 20_000 });
		const paragraphs = await page.locator('[data-testid="note-body"] p').count();
		check('阅读页渲染出正文段落', paragraphs > 3, `${paragraphs} 个段落`);
		check('阅读页渲染出标题', (await page.locator('[data-testid="note-body"] h1').count()) === 1);

		// 深层 URL 现在是真实预渲染页面：状态码 200、正文在 HTML 里、可被索引。
		// 改成 SSR 之前它走 404.html fallback —— 浏览器里看着正常，HTTP 状态却是 404，
		// 分享出去和被爬虫抓到都算失效链接。
		const deepRes = await fetch(`${BASE}${noteHref}`);
		const deepHtml = await deepRes.text();
		check(
			'深层笔记 URL 返回 200（不再靠 fallback）',
			deepRes.status === 200,
			`HTTP ${deepRes.status}`
		);
		check(
			'正文在服务端渲染的 HTML 里（可被搜索引擎抓取）',
			(deepHtml.match(/<p>/g) ?? []).length > 3,
			`${(deepHtml.match(/<p>/g) ?? []).length} 个段落`
		);
		check('阅读页不再带 noindex', !deepHtml.includes('noindex'));
		check('阅读页有 canonical', /<link rel="canonical"/.test(deepHtml));
		check(
			'正文里的相对 .md 链接已改写成站内路由',
			!/href="[^"]*\.md"/.test(deepHtml.replace(/href="https?:[^"]*"/g, '')),
			'无残留 .md 内链'
		);

		await page.goto(`${BASE}${noteHref}`, { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-testid="note-body"] p', { timeout: 20_000 });
		check(
			'直接访问深层笔记 URL 可渲染',
			(await page.locator('[data-testid="note-body"] p').count()) > 3
		);

		// 已读标记要能持久化
		await page.getByTestId('mark-read').click();
		await page.waitForTimeout(150);
		const readStored = await page.evaluate(() => {
			const raw = localStorage.getItem('ael-notes-progress-v1');
			return raw ? (JSON.parse(raw).read ?? []).length : 0;
		});
		check('已读标记写入独立的 localStorage key', readStored === 1, `${readStored} 篇`);
		check(
			'笔记进度不污染题目进度',
			await page.evaluate(() => {
				const quizRaw = localStorage.getItem('ael-progress-v1');
				if (!quizRaw) return true;
				return !JSON.stringify(JSON.parse(quizRaw)).includes('notes');
			})
		);

		// ---------- 笔记 ↔ 关卡双向互链 ----------
		// 不硬编码 slug：从列表里找带「关卡」徽章的篇目，走完整闭环。
		// 这样改映射表不会让测试失效，而互链断掉一定会被抓到。
		await page.goto(`${BASE}/notes`, { waitUntil: 'networkidle' });
		await page.getByTestId('view-catalog').click();
		await page.waitForSelector('a.note-link');
		// 模块默认折叠，带关卡标记的篇目在收起的模块里。先全部展开再断言。
		// 必须每次重新取第一个：点击会改变 aria-expanded，.all() 的快照会立刻失效
		for (let i = 0; i < 10; i++) {
			const collapsedToggle = page.locator('.mod-toggle[aria-expanded="false"]').first();
			if ((await collapsedToggle.count()) === 0) break;
			await collapsedToggle.click();
		}
		await page.waitForSelector('[data-testid="note-has-level"]');
		const linkedCount = await page.locator('[data-testid="note-has-level"]').count();
		check('笔记列表标出哪些篇目有配套关卡', linkedCount > 0, `${linkedCount} 篇`);

		await page.locator('a.note-link:has([data-testid="note-has-level"])').first().click();
		await page.waitForSelector('[data-testid="note-level-link"]');
		const noteUrl = page.url();
		await page.getByTestId('note-level-link').click();
		await page.waitForURL(anyLevel);
		check('笔记页可点达配套关卡', anyLevel.test(page.url()), page.url());

		// 反向：关卡页要能回到背景笔记
		await page.waitForSelector('[data-testid="background-note-link"]');
		const bgCount = await page.locator('[data-testid="background-note-link"]').count();
		check('关卡页列出背景笔记', bgCount > 0, `${bgCount} 篇`);

		await page.getByTestId('background-note-link').first().click();
		await page.waitForSelector('[data-testid="note-body"] p', { timeout: 20_000 });
		check(
			'关卡页可点回背景笔记（闭环成立）',
			page.url().includes('/notes/'),
			`${noteUrl.split('/notes/')[1] ?? ''} → 关卡 → ${page.url().split('/notes/')[1] ?? ''}`
		);

		// ---------- Tier A：笔记里的可判定题 ----------
		const gradableData = JSON.parse(await readFile('build/notes/gradable.json', 'utf8'));
		const gradableSlugs = Object.keys(gradableData.items ?? {});
		check(
			'可判定题已产出',
			gradableData.total > 0 && gradableSlugs.length > 0,
			`${gradableData.total} 道 / ${gradableSlugs.length} 篇`
		);
		check(
			'题目 id 全部带 note: 命名空间（不与关卡题撞车）',
			gradableSlugs
				.flatMap((s) => gradableData.items[s])
				.every((q) => q.id.startsWith('note:') && q.kind === 'choice')
		);

		// 从产物里取第一篇有题的笔记，不硬编码 slug
		const gSlug = gradableSlugs[0];
		const gQuestions = gradableData.items[gSlug];
		const gUrl = `${BASE}/notes/${gSlug.split('/').map(encodeURIComponent).join('/')}`;
		await page.goto(gUrl, { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-testid="note-gradable"]');
		const gCounter = await page.getByTestId('note-gradable-counter').innerText();
		check(
			'笔记页渲染可判定题',
			gCounter.includes(`/ ${gQuestions.length} 题`),
			gCounter.replace(/\s+/g, ' ')
		);

		// 故意选错：正确下标从产物里读，所以永远能构造出一个错误选项
		const wrongIndex = gQuestions[0].answerIndex === 0 ? 1 : 0;
		await page.locator('.option').nth(wrongIndex).click();
		await page.getByRole('button', { name: '提交' }).click();
		await page.waitForSelector('.msg-bad');
		check('笔记题答错给出反馈', (await page.locator('.msg-bad').count()) === 1);
		check('答错后不直接公布答案', (await page.locator('.explanation').count()) === 0);

		await page.getByRole('button', { name: '再试一次' }).click();
		await page.locator('.option').nth(gQuestions[0].answerIndex).click();
		await page.getByRole('button', { name: '提交' }).click();
		await page.waitForSelector('.msg-ok');
		check('笔记题答对展开推导', (await page.locator('.explanation').count()) === 1);

		check(
			'笔记题进度写进与关卡题相同的存储',
			await page.evaluate((id) => {
				const raw = localStorage.getItem('ael-progress-v1');
				if (!raw) return false;
				return Boolean(JSON.parse(raw).records?.[id]);
			}, gQuestions[0].id),
			gQuestions[0].id
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
