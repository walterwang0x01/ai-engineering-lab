<script lang="ts">
	/**
	 * 页面元数据与社交分享卡片。
	 *
	 * 没有这些标签，分享到 X / 微信 / Slack 就是一条光秃秃的链接，
	 * 传播效果差一大截。og:image 必须是**绝对 URL** 且为 PNG/JPG——
	 * 相对路径和 SVG 都不被抓取器接受，这是最常见的踩坑点。
	 */
	import { page } from '$app/state';

	interface Props {
		title: string;
		description: string;
		/** OG 图文件名，位于 static/og/ 下 */
		ogImage?: string;
	}

	let { title, description, ogImage = 'home.png' }: Props = $props();

	/** 站点线上根地址。抓取器要求绝对 URL，所以必须硬编码而不能靠相对路径 */
	const SITE = 'https://walterwang0x01.github.io/ai-engineering-lab';

	const canonical = $derived(`${SITE}${page.url.pathname.replace(/\/$/, '')}`);
	const imageUrl = $derived(`${SITE}/og/${ogImage}`);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />

	<!-- Open Graph：微信、Slack、Facebook、LinkedIn 等 -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="AI Engineering Lab" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={imageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:locale" content="zh_CN" />

	<!-- Twitter / X：summary_large_image 才会显示大图卡片 -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={imageUrl} />
	<meta name="twitter:image:alt" content={title} />
</svelte:head>
