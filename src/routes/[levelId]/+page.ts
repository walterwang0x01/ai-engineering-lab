/**
 * 关卡页数据加载。
 *
 * entries 告诉 adapter-static 要预渲染哪些路径——
 * 动态路由默认不知道有哪些 id，漏了这个会构建失败。
 */

import { error } from '@sveltejs/kit';
import { getLevel, LEVEL_IDS } from '$lib/levels/registry';
import type { EntryGenerator, PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const level = getLevel(params.levelId);
	if (!level) error(404, `未知关卡：${params.levelId}`);
	return { level };
};

/** 预渲染全部关卡路径 */
export const entries: EntryGenerator = () => LEVEL_IDS.map((levelId) => ({ levelId }));
