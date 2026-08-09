/**
 * 题库校验。
 *
 * 存在的理由：进度存储是**全站单例、单一命名空间**
 * （见 storage/progress.svelte.ts 的 records），所有关卡的题目 id 共享同一个 key 空间。
 * 两个关卡各起一个 `01-baseline` 就会让间隔重复状态互相覆盖 ——
 * 而这个 bug 在按关卡文件隔离跑的单元测试里完全看不出来，
 * 只在用户练完两关之后才暴露。
 *
 * 所以 id 前缀不能只写在文档里靠自觉，必须是门禁。
 * 每个题库的 spec 调用 assertValidQuestionSet 即可获得全部校验。
 */

import { judge } from './judge';
import type { Question } from './types';

/** 一条校验失败的描述 */
export interface ValidationIssue {
	questionId: string;
	problem: string;
}

/**
 * 校验一个题库。
 *
 * @param questions 题库
 * @param levelId 关卡 id。所有题目 id 必须以 `${levelId}-` 开头，避免跨关卡撞车
 * @returns 问题清单，空数组表示通过
 */
export function validateQuestionSet(questions: Question[], levelId: string): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (questionId: string, problem: string) => issues.push({ questionId, problem });

	if (questions.length === 0) {
		add('(题库)', '题库为空');
		return issues;
	}

	const seen = new Set<string>();

	for (const q of questions) {
		// id 唯一性
		if (seen.has(q.id)) add(q.id, 'id 重复');
		seen.add(q.id);

		// id 前缀：跨关卡命名空间隔离的唯一保障
		if (!q.id.startsWith(`${levelId}-`)) {
			add(q.id, `id 必须以 "${levelId}-" 开头，否则可能与其他关卡的题目撞车`);
		}

		if (q.prompt.trim() === '') add(q.id, '题干为空');
		if (q.explanation.trim() === '') add(q.id, '解释为空');

		if (q.kind === 'numeric') {
			if ((q.tolerance ?? 0) < 0) add(q.id, 'tolerance 不能为负');
			if ((q.relativeTolerance ?? 0) < 0) add(q.id, 'relativeTolerance 不能为负');
			if (!Number.isFinite(q.answer)) add(q.id, 'answer 必须是有限数值');
		} else {
			if (q.options.length < 2) add(q.id, '选项少于 2 个');
			if (q.answerIndex < 0 || q.answerIndex >= q.options.length) {
				add(q.id, `answerIndex ${q.answerIndex} 超出选项范围`);
			}
			if (q.options.some((o) => o.trim() === '')) add(q.id, '存在空选项');
			// 选项重复会让题目出现两个"正确"答案
			if (new Set(q.options).size !== q.options.length) add(q.id, '存在重复选项');

			for (const key of Object.keys(q.distractorNotes ?? {})) {
				const idx = Number(key);
				if (idx === q.answerIndex) add(q.id, 'distractorNotes 不应包含正确答案的下标');
				if (idx < 0 || idx >= q.options.length) {
					add(q.id, `distractorNotes 的下标 ${idx} 超出选项范围`);
				}
			}
		}

		// 标准答案必须能通过自身判定。
		// 抓的是"容差设成 0 却给了需要容差的小数答案"这类自相矛盾。
		const canonical = q.kind === 'numeric' ? String(q.answer) : q.answerIndex;
		if (!judge(q, canonical).correct) {
			add(q.id, '标准答案无法通过判定引擎，检查容差设置');
		}
	}

	return issues;
}

/**
 * 校验失败时抛出可读错误。测试里直接调用这个。
 *
 * @throws 当题库存在任何问题时
 */
export function assertValidQuestionSet(questions: Question[], levelId: string): void {
	const issues = validateQuestionSet(questions, levelId);
	if (issues.length === 0) return;

	const detail = issues.map((i) => `  · [${i.questionId}] ${i.problem}`).join('\n');
	throw new Error(`题库 "${levelId}" 存在 ${issues.length} 处问题：\n${detail}`);
}
