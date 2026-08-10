import { describe, expect, it } from 'vitest';
import {
	extractNoteQuestions,
	findQuizBlocks,
	mergeSources,
	noteNamespace,
	parseLocalQuestions
} from '../../../scripts/lib/extract-quiz.mjs';
import { assertValidQuestionSet, validateQuestionSet } from '$lib/quiz/validate';

/**
 * Tier A 抽取管道的门禁。
 *
 * 这个管道要覆盖 168 篇笔记，一旦它把坏题静默放过，错误内容就会批量上线。
 * 所以测试的重点全在**拒绝**：每一类结构错误都必须被抓住并给出可定位的报错。
 *
 * 最后一条最关键：抽出来的题必须能通过 `assertValidQuestionSet`——
 * 那是关卡题库用的同一道校验，两条路径共用一个质量标准。
 */

const SLUG = '00-入门准备/01-AI技术全景与概念辨析';

/** 一道结构完整、已过审的题 */
function good(overrides = {}) {
	return {
		id: 'concept-split',
		prompt: '机器学习与深度学习的关系是？',
		options: ['深度学习是机器学习的子集', '两者互不相交', '机器学习是深度学习的子集'],
		answerIndex: 0,
		explanation: '深度学习是机器学习中以多层神经网络为模型族的一支。',
		reviewed: true,
		...overrides
	};
}

/** 把题目数组包进 markdown 的 ael-quiz 围栏块 */
function block(items: unknown): string {
	return [
		'# 标题',
		'',
		'正文段落。',
		'',
		'```ael-quiz',
		JSON.stringify(items, null, 2),
		'```',
		''
	].join('\n');
}

describe('围栏块扫描', () => {
	it('取出块内容，不含围栏行', () => {
		const blocks = findQuizBlocks('前言\n\n```ael-quiz\n[1]\n```\n\n后记');
		expect(blocks).toEqual(['[1]']);
	});

	it('忽略其他语言的代码块', () => {
		const blocks = findQuizBlocks('```python\nprint(1)\n```\n\n```ael-quiz\n[]\n```');
		expect(blocks).toEqual(['[]']);
	});

	it('同一篇里的多个块都能取到', () => {
		const blocks = findQuizBlocks('```ael-quiz\nA\n```\ntext\n```ael-quiz\nB\n```');
		expect(blocks).toEqual(['A', 'B']);
	});

	it('未闭合的块整块丢弃，不解析半个块', () => {
		expect(findQuizBlocks('```ael-quiz\n[{"id":"x"}')).toEqual([]);
	});
});

describe('题目 id 命名空间', () => {
	it('用 note: 前缀，永不与关卡题撞车', () => {
		const { questions } = extractNoteQuestions(SLUG, block([good()]));
		expect(questions[0].id).toBe(`note:${SLUG}-concept-split`);
		expect(noteNamespace(SLUG)).toBe(`note:${SLUG}`);
	});

	it('抽出的题通过关卡题库用的同一道校验', () => {
		const { questions } = extractNoteQuestions(SLUG, block([good(), good({ id: 'second' })]));
		expect(() => assertValidQuestionSet(questions, noteNamespace(SLUG))).not.toThrow();
		expect(validateQuestionSet(questions, noteNamespace(SLUG))).toEqual([]);
	});
});

describe('reviewed 门禁', () => {
	it('reviewed 为 false 的只计数，不进产物', () => {
		const r = extractNoteQuestions(SLUG, block([good({ reviewed: false })]));
		expect(r.questions).toEqual([]);
		expect(r.drafts).toBe(1);
		expect(r.issues).toEqual([]);
	});

	it('缺少 reviewed 字段是错误，不默认放行', () => {
		const raw = good();
		delete (raw as Record<string, unknown>).reviewed;
		const r = extractNoteQuestions(SLUG, block([raw]));
		expect(r.questions).toEqual([]);
		expect(r.issues.some((i) => i.problem.includes('reviewed'))).toBe(true);
	});

	it('过审与草稿混在一起时只放过审的', () => {
		const r = extractNoteQuestions(
			SLUG,
			block([good(), good({ id: 'draft-one', reviewed: false })])
		);
		expect(r.questions.length).toBe(1);
		expect(r.drafts).toBe(1);
	});
});

describe('结构错误必须被拒绝', () => {
	const cases: Array<[string, Record<string, unknown>, string]> = [
		['数值题被明确拒绝', { kind: 'numeric' }, 'choice'],
		['选项少于 2 个', { options: ['只有一个'] }, 'options'],
		['存在空选项', { options: ['正常', '  '] }, '空选项'],
		['存在重复选项', { options: ['同样', '同样'] }, '重复选项'],
		['answerIndex 越界', { answerIndex: 9 }, '超出选项范围'],
		['answerIndex 不是整数', { answerIndex: 1.5 }, '整数'],
		['题干为空', { prompt: '   ' }, 'prompt'],
		['解释为空', { explanation: '' }, 'explanation'],
		['id 含非法字符', { id: 'Bad_ID' }, 'id'],
		['字段名拼错', { answerIdx: 0 }, '未知字段'],
		['distractorNotes 指向正确答案', { distractorNotes: { 0: '解释' } }, '正确答案'],
		['distractorNotes 下标越界', { distractorNotes: { 7: '解释' } }, '超出选项范围'],
		['distractorNotes 内容为空', { distractorNotes: { 1: '' } }, 'distractorNotes']
	];

	for (const [label, override, expectedFragment] of cases) {
		it(label, () => {
			const r = extractNoteQuestions(SLUG, block([good(override)]));
			expect(r.questions, `${label} 不该产出题目`).toEqual([]);
			expect(
				r.issues.some((i) => i.problem.includes(expectedFragment)),
				`报错里应包含「${expectedFragment}」，实际是：${r.issues.map((i) => i.problem).join(' / ')}`
			).toBe(true);
		});
	}

	it('JSON 语法错误报出解析位置', () => {
		const r = extractNoteQuestions(SLUG, '```ael-quiz\n[{"id": }]\n```');
		expect(r.issues[0].problem).toContain('JSON 解析失败');
		expect(r.issues[0].where).toContain(SLUG);
	});

	it('块内容不是数组时报错', () => {
		const r = extractNoteQuestions(SLUG, block(good()));
		expect(r.issues.some((i) => i.problem.includes('JSON 数组'))).toBe(true);
	});

	it('同一篇里 id 重复被拒绝', () => {
		const r = extractNoteQuestions(SLUG, block([good(), good()]));
		expect(r.questions.length).toBe(1);
		expect(r.issues.some((i) => i.problem.includes('id 重复'))).toBe(true);
	});

	it('报错带来源定位，能直接找到出错的块', () => {
		const r = extractNoteQuestions(SLUG, block([good({ options: ['x'] })]));
		expect(r.issues[0].where).toContain(SLUG);
		expect(r.issues[0].where).toMatch(/第 1 题/);
	});
});

describe('本地题库来源', () => {
	it('与 markdown 块共用同一套校验', () => {
		const ok = parseLocalQuestions(SLUG, JSON.stringify([good()]));
		expect(ok.questions.length).toBe(1);
		const bad = parseLocalQuestions(SLUG, JSON.stringify([good({ answerIndex: 9 })]));
		expect(bad.issues.some((i) => i.problem.includes('超出选项范围'))).toBe(true);
	});

	it('文件不是数组时报错并指出文件路径', () => {
		const r = parseLocalQuestions(SLUG, '{}');
		expect(r.issues[0].where).toContain('content/note-questions');
	});

	it('两个来源的题目合并到一起', () => {
		const inline = extractNoteQuestions(SLUG, block([good()]));
		const local = parseLocalQuestions(SLUG, JSON.stringify([good({ id: 'from-local' })]));
		const merged = mergeSources(SLUG, inline, local);
		expect(merged.questions.map((q) => q.id)).toEqual([
			`note:${SLUG}-concept-split`,
			`note:${SLUG}-from-local`
		]);
		expect(merged.issues).toEqual([]);
	});

	it('同一个 id 在两个来源都出现时报错，来源必须唯一', () => {
		const inline = extractNoteQuestions(SLUG, block([good()]));
		const local = parseLocalQuestions(SLUG, JSON.stringify([good()]));
		const merged = mergeSources(SLUG, inline, local);
		expect(merged.issues.some((i) => i.problem.includes('来源必须唯一'))).toBe(true);
		expect(merged.questions.length).toBe(1);
	});
});
