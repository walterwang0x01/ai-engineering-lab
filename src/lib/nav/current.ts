/**
 * 顶栏「当前页」判定。
 *
 * ⚠️ 用 **route.id**（路由标识）而不是 `page.url.pathname` 判定，原因是一个只能
 * 在线上复现的坑：
 *
 * 站点部署在子路径（BASE_PATH=/ai-engineering-lab），于是
 *   - page.url.pathname 是**带前缀**的真实 URL：`/ai-engineering-lab/notes`
 *   - 而 `base` 是**相对当前页的路径**：顶层页是 `.`，深层笔记页是 `../../..`
 *     （因为 paths.relative 默认为 true）
 *
 * 也就是说，既不能拿 pathname 直接跟 '/notes' 比（线上恒不命中），
 * 也不能用 base 去剥前缀（base 是相对路径，剥不干净）。
 * 结果就是当前页指示线上全灭、本地全绿 —— 本地和 CI 冒烟跑的都是根路径构建。
 *
 * route.id 是框架给出的路由标识（`/`、`/levels`、`/notes`、`/notes/[...slug]`），
 * 无论部署在根还是子路径、无论 paths.relative 是开是关，它都不变。
 * 用它可以从根上消除这类「只在某个部署形态下成立」的判定。
 */

/**
 * 当前路由是否落在某个导航项下。
 *
 * 两段判定（等于 prefix，或以 prefix/ 开头）而不是裸 startsWith ——
 * 否则 /notes-archive 会被误判成命中 /notes。
 * 以 prefix/ 开头这条让「笔记详情页」自动归到「笔记库」下，
 * 不用把 /notes/[...slug] 也写进列表。
 *
 * @param routeId `page.route.id`，未匹配到路由时为 null（真 404 时不点亮任何一项）
 * @param prefixes 该导航项覆盖的路由。'/levels' 与 '/[levelId]' 同属「关卡」——
 *   关卡详情页挂在根路径下（/backprop），不这样归并的话，从 /levels 点进某个
 *   关卡后高亮会消失，恰好是这个特性要消灭的「我在哪」缺口。
 */
export function isNavCurrent(
	routeId: string | null | undefined,
	prefixes: readonly string[]
): boolean {
	if (!routeId) return false;
	return prefixes.some((prefix) => routeId === prefix || routeId.startsWith(`${prefix}/`));
}
