/**
 * 阅读页禁用预渲染：196 篇笔记全部预渲染会让构建变慢、产物变大，
 * 也会让 adapter-static 的 entries 生成器要枚举全部 slug（多一层耦合）。
 *
 * 改为客户端渲染：ssr = false 让这个路由完全交给浏览器处理，
 * 服务器/构建期不执行 load，页面在客户端 fetch static/notes/ 下的
 * 原始 markdown 后本地渲染。adapter-static 只需要产出一份不含具体 slug
 * 的 HTML 壳（因为路由是 [...slug] 通配），浏览器拿到壳后由路由处理
 * 具体的 slug 参数、发起 fetch、渲染内容。
 *
 * 代价：这个页面对搜索引擎不可见（没有可抓取的服务端渲染内容），
 * 对于 196 篇内部学习笔记，这个代价可以接受——它们不是站点的 SEO 入口，
 * /notes 学习路径页才是，而它是预渲染的。
 */
export const prerender = false;
export const ssr = false;
