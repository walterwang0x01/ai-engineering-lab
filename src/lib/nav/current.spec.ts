import { describe, expect, it } from 'vitest';
import { isNavCurrent } from './current';

/**
 * 这些用例存在的唯一理由：顶栏当前页指示曾是**线上全灭、本地全绿**。
 *
 * 原实现拿 `page.url.pathname` 跟 '/notes' 比。站点部署在 /ai-engineering-lab
 * 子路径下，pathname 带前缀，于是线上恒不命中，三个导航链接一个都不亮；
 * 而本地 build 和 CI 冒烟都是根路径构建，测不出来。
 *
 * 现在改用 route.id —— 它对部署位置免疫。下面的用例因此不需要构造子路径：
 * 判定本身压根不接触 URL，这正是当初选它的原因。
 */

// 与 src/routes 下的真实路由标识保持一致
const HOME = '/';
const LEVELS = '/levels';
const NOTES = '/notes';
const NOTE_DETAIL = '/notes/[...slug]';
const LEVEL_DETAIL = '/[levelId]';

// 顶栏三个导航项各自覆盖的路由，与 +layout.svelte 中的调用保持一致
const NAV_HOME = ['/'];
const NAV_LEVELS = [LEVELS, LEVEL_DETAIL];
const NAV_NOTES = [NOTES];

describe('isNavCurrent', () => {
	it('首页只点亮「学习路径」', () => {
		expect(isNavCurrent(HOME, NAV_HOME)).toBe(true);
		expect(isNavCurrent(HOME, NAV_NOTES)).toBe(false);
		expect(isNavCurrent(HOME, NAV_LEVELS)).toBe(false);
	});

	it('关卡索引页只点亮「关卡」', () => {
		expect(isNavCurrent(LEVELS, NAV_LEVELS)).toBe(true);
		expect(isNavCurrent(LEVELS, NAV_HOME)).toBe(false);
		expect(isNavCurrent(LEVELS, NAV_NOTES)).toBe(false);
	});

	it('笔记库索引页点亮「笔记库」', () => {
		expect(isNavCurrent(NOTES, NAV_NOTES)).toBe(true);
		expect(isNavCurrent(NOTES, NAV_HOME)).toBe(false);
	});

	it('笔记详情页也算在「笔记库」这条线下', () => {
		expect(isNavCurrent(NOTE_DETAIL, NAV_NOTES)).toBe(true);
		expect(isNavCurrent(NOTE_DETAIL, NAV_HOME)).toBe(false);
		expect(isNavCurrent(NOTE_DETAIL, NAV_LEVELS)).toBe(false);
	});

	it('关卡详情页也算在「关卡」这条线下', () => {
		// 关卡正文挂在根路径（/backprop），不归并的话点进关卡后高亮就没了
		expect(isNavCurrent(LEVEL_DETAIL, NAV_LEVELS)).toBe(true);
		expect(isNavCurrent(LEVEL_DETAIL, NAV_HOME)).toBe(false);
		expect(isNavCurrent(LEVEL_DETAIL, NAV_NOTES)).toBe(false);
	});

	it('未匹配到路由时（真 404）不点亮任何一项', () => {
		expect(isNavCurrent(null, NAV_HOME)).toBe(false);
		expect(isNavCurrent(null, NAV_NOTES)).toBe(false);
		expect(isNavCurrent(undefined, NAV_NOTES)).toBe(false);
	});
});

describe('边界：不做裸前缀匹配', () => {
	it('不把 /notes-archive 当成 /notes', () => {
		expect(isNavCurrent('/notes-archive', NAV_NOTES)).toBe(false);
	});

	it('不把 /levels-extra 当成 /levels', () => {
		expect(isNavCurrent('/levels-extra', NAV_LEVELS)).toBe(false);
	});

	it('根 prefix 不会因为 startsWith 而命中所有路由', () => {
		// 若实现写成 startsWith('/')，/notes 会被误判成首页
		expect(isNavCurrent(NOTES, NAV_HOME)).toBe(false);
		expect(isNavCurrent(LEVEL_DETAIL, NAV_HOME)).toBe(false);
	});
});
