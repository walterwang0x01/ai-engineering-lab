/**
 * 生成社交分享用的 OG 图（1200×630 PNG）。
 *
 * 为什么用 playwright 截图而不是 satori：
 * satori 需要手动喂字体文件，中文字体动辄十几 MB，还得处理字形子集化。
 * 项目里已经有 playwright（组件测试和冒烟测试在用），
 * 直接用系统中文字体渲染真实 HTML，零新增依赖、中文排版天然正确。
 *
 * 产物提交进仓库，不进构建流程 —— OG 图很少变，
 * 每次构建都跑一遍浏览器是浪费。内容改了手动重跑：
 *   node scripts/generate-og.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT_DIR = 'static/og';

/** 与站点 layout.css 中的 @theme 保持一致 */
const TOKENS = {
	surface: '#12141a',
	raised: '#1a1d24',
	sunken: '#0e1015',
	border: '#3a3f4b',
	accent: '#22d3ee',
	ok: '#34d399',
	bad: '#fb7185',
	text: '#e8eaed',
	muted: '#9aa0aa'
};

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const MONO_STACK = "'SF Mono', Menlo, Monaco, Consolas, monospace";

/**
 * @param {{ eyebrow: string, title: string, lines: string[], stats: Array<{ value: string, label: string, tone?: 'ok'|'bad'|'accent' }> }} spec
 */
function template(spec) {
	const stats = spec.stats
		.map((s) => {
			const color = s.tone === 'ok' ? TOKENS.ok : s.tone === 'bad' ? TOKENS.bad : TOKENS.accent;
			// flex-shrink:0 + nowrap 是必须的：否则 flex 会压缩子项，
			// 把「可判定」断成「可判/定」、「320 GB」断成「320/GB」
			return `
			<div style="display:flex; flex-direction:column; gap:8px; flex-shrink:0; white-space:nowrap;">
				<div style="font:700 44px ${MONO_STACK}; color:${color}; line-height:1;">${s.value}</div>
				<div style="font:400 19px ${FONT_STACK}; color:${TOKENS.muted};">${s.label}</div>
			</div>`;
		})
		.join('');

	const lines = spec.lines
		.map(
			(l) =>
				`<div style="font:400 27px ${FONT_STACK}; color:${TOKENS.text}; line-height:1.6; opacity:.9; white-space:nowrap;">${l}</div>`
		)
		.join('');

	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /></head>
<body style="margin:0; width:1200px; height:630px; background:${TOKENS.surface}; overflow:hidden;">
	<!-- 左侧强调条，呼应站内的 border-left 强调样式 -->
	<div style="position:absolute; left:0; top:0; bottom:0; width:8px; background:${TOKENS.accent};"></div>

	<!-- 右下角的极淡网格，避免大面积纯色显得空 -->
	<div style="position:absolute; right:-100px; bottom:-160px; width:640px; height:640px;
		background-image:linear-gradient(${TOKENS.border} 1px, transparent 1px),
			linear-gradient(90deg, ${TOKENS.border} 1px, transparent 1px);
		background-size:48px 48px; opacity:.16; transform:rotate(-8deg);"></div>

	<div style="position:relative; height:100%; padding:70px 84px; box-sizing:border-box;
		display:flex; flex-direction:column; justify-content:space-between;">

		<div>
			<!-- URL 放右上角与 eyebrow 同行：底部若与 stats 挤在一行会超出可用宽度 -->
			<div style="display:flex; align-items:baseline; justify-content:space-between;
				gap:32px; margin-bottom:28px; white-space:nowrap;">
				<div style="font:500 20px ${MONO_STACK}; color:${TOKENS.accent};
					letter-spacing:.16em; text-transform:uppercase;">${spec.eyebrow}</div>
				<div style="font:400 19px ${MONO_STACK}; color:${TOKENS.muted};">
					walterwang0x01.github.io/ai-engineering-lab
				</div>
			</div>

			<div style="font:700 62px ${FONT_STACK}; color:${TOKENS.text};
				line-height:1.22; letter-spacing:-.01em; margin-bottom:28px;
				white-space:pre-line;">${spec.title}</div>

			<div style="display:flex; flex-direction:column; gap:10px;">${lines}</div>
		</div>

		<!-- stats 独占底部整行，宽度充足 -->
		<div style="display:flex; gap:60px; align-items:flex-end;">${stats}</div>
	</div>
</body></html>`;
}

const PAGES = [
	{
		file: 'home.png',
		spec: {
			eyebrow: 'AI Engineering Lab',
			title: '把 AI 工程知识\n变成能动手验证的东西',
			lines: [
				'每个概念都配可判定的计算题和能调参数的沙盒',
				'答错告诉你错在哪 · 调参数看约束怎么被打破'
			],
			stats: [
				{ value: '可判定', label: '不是自评', tone: 'accent' },
				{ value: '纯前端', label: '无后端 · 免费开源', tone: 'ok' },
				{ value: '1/3/7/16/35', label: '间隔重复，不是打卡', tone: 'accent' }
			]
		}
	},
	{
		file: 'kv-cache.png',
		spec: {
			eyebrow: '推理优化 · 第 1 关',
			title: 'KV Cache 容量规划',
			lines: [
				'算出「这个模型这个并发要几张卡」',
				'双约束沙盒：显存和质量同时要满足，光选最省的通不过'
			],
			stats: [
				{ value: '320 GB', label: 'MHA + fp16 基线', tone: 'bad' },
				{ value: '20 GB', label: 'GQA 8 组 + int8', tone: 'ok' },
				{ value: '3 / 12', label: '配置组合中的可行解', tone: 'accent' }
			]
		}
	},
	{
		file: 'attention.png',
		spec: {
			eyebrow: 'Transformer 原理 · 第 2 关',
			title: 'Attention 与因果掩码',
			lines: [
				'注意力显存为什么随序列长度平方增长',
				'缩放因子 1/√d_k 从哪来 · Flash Attention 省掉的是什么'
			],
			stats: [
				{ value: '4096² → 1 GB', label: '分数矩阵，seq 翻倍变 4 倍', tone: 'bad' },
				{ value: '√64 = 8', label: '点积标准差 = 缩放因子来历', tone: 'accent' },
				{ value: '17×', label: 'Flash 省掉的显存', tone: 'ok' }
			]
		}
	}
];

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
try {
	const page = await browser.newPage({
		viewport: { width: 1200, height: 630 },
		// deviceScaleFactor 1：OG 图规范就是 1200×630，放大反而超出平台体积限制
		deviceScaleFactor: 1
	});

	for (const { file, spec } of PAGES) {
		const html = template(spec);
		await page.setContent(html, { waitUntil: 'load' });
		// 等字体真正就绪，否则可能截到 fallback 字体
		await page.evaluate(() => document.fonts.ready);
		// 程序化检测溢出：nowrap 的文本一旦超出容器，目测容易漏，
		// 让浏览器自己报告哪个元素超宽
		const overflow = await page.evaluate(() => {
			const bad = [];
			for (const el of document.querySelectorAll('div')) {
				if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
					bad.push({
						text: (el.textContent ?? '').trim().slice(0, 40),
						scrollWidth: el.scrollWidth,
						clientWidth: el.clientWidth
					});
				}
			}
			return bad;
		});
		if (overflow.length > 0) {
			console.error(`❌ ${file} 存在横向溢出：`);
			for (const o of overflow) {
				console.error(`   "${o.text}" ${o.scrollWidth}px > ${o.clientWidth}px`);
			}
			process.exitCode = 1;
		}

		const buffer = await page.screenshot({ type: 'png' });
		await writeFile(`${OUT_DIR}/${file}`, buffer);
		console.log(`✅ ${OUT_DIR}/${file}  ${(buffer.length / 1024).toFixed(0)} KB`);
	}
} finally {
	await browser.close();
}
