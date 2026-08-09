/**
 * 主线程与 Pyodide Worker 之间的消息协议。
 *
 * 单独一个文件是为了让两侧共享同一份类型定义——
 * 协议不一致会导致运行时静默失败，而 TypeScript 抓不到跨 Worker 边界的错。
 */

import type { CodeRunResult, CodeTestCase } from '$lib/quiz/types';

/**
 * Pyodide 资源地址。
 *
 * **同源优先，CDN 回退。**
 *
 * 为什么不直接用 CDN：实测 jsDelivr 上 9.6MB 的 pyodide.asm.wasm
 * 下载速度只有 24.9 KB/s，需要 6.4 分钟。对国内网络这是常态而非异常，
 * 用户根本等不到。同源托管走站点自己的 CDN——能打开站点就能加载运行时。
 *
 * 资源由 scripts/sync-pyodide.mjs 从 node_modules 复制到 static/pyodide/，
 * 所以版本天然与 package.json 一致，不会出现「胶水新、WASM 旧」这种
 * 极难排查的不匹配。
 *
 * 保留 CDN 回退是为了兜住一种情况：部署环境上 static 资源缺失
 * （比如忘了跑 sync 脚本）。此时慢总比完全不可用好。
 */
export const PYODIDE_VERSION = '314.0.3';

/** 同源路径。由 SvelteKit 的 base 决定实际前缀，运行时拼接 */
export const PYODIDE_LOCAL_PATH = 'pyodide/';

/** 第三方 CDN，仅在同源加载失败时使用 */
export const PYODIDE_CDN_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** 主线程 → Worker */
export type WorkerRequest =
	| {
			/**
			 * 告知 Worker 同源资源的基址。
			 *
			 * Worker 里拿不到 SvelteKit 的 base path，也不能可靠地从
			 * import.meta.url 推断（Worker chunk 在 _app/immutable/workers/ 下，
			 * 相对层级与站点根不同），所以由主线程显式传入。
			 */
			type: 'configure';
			originBase: string;
	  }
	| {
			/** 预热：提前加载 Pyodide，不执行代码 */
			type: 'warmup';
	  }
	| {
			type: 'run';
			/** 本次运行的标识，用于把结果对应回请求 */
			id: string;
			/** 用户改不到的准备代码 */
			setupCode?: string;
			/** 用户编辑器里的代码 */
			userCode: string;
			tests: CodeTestCase[];
			packages?: string[];
	  };

/** Worker → 主线程 */
export type WorkerResponse =
	| {
			/** Pyodide 就绪 */
			type: 'ready';
	  }
	| {
			/** 加载进度，用于给用户反馈而不是干等 */
			type: 'progress';
			detail: string;
	  }
	| {
			type: 'result';
			id: string;
			result: CodeRunResult;
	  };
