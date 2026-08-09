// 全站静态预渲染：整个站点导出为纯静态文件，可部署到任意静态托管
// 学习状态全部存在浏览器端（localStorage，见 src/lib/storage/backend.ts），不需要服务端
export const prerender = true;

// 关闭尾斜杠差异，避免静态托管在 /a 和 /a/ 之间产生重复内容
export const trailingSlash = 'never';
