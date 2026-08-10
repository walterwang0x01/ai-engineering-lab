/**
 * /notes 是预渲染的静态壳：manifest 数据在客户端 fetch static/notes/manifest.json 获取，
 * 不在 load 里同步读取文件系统——这样预渲染产物里没有 168 篇笔记的数据，
 * 构建期不需要在这个页面上花时间，产物也不会因为笔记数据膨胀。
 */
export const prerender = true;
