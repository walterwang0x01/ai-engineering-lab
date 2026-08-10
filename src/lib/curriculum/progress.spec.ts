import { describe, expect, it } from 'vitest';
import { MAX_BOX } from '$lib/quiz/schedule';
import { getLevel } from '$lib/levels/registry';
import { notesForLevel } from './mapping';
import { buildCurriculum } from './build';
import { curriculumProgress, moduleProgress, noteProgress, type ScheduleView } from './progress';
import type { NoteEntry, NotesManifest } from '$lib/notes/types';

/**
 * 统一进度视图的门禁。
 *
 * 核心要守住的是一条裁决规则：**可判定信号优先于自评信号**。
 * 两套存储各自记着不同的事，展示层必须给出唯一结论，
 * 否则用户会看到「已读 0 篇」和「已掌握 12 题」同时出现，不知道信哪个。
 */

function note(slug: string): NoteEntry {
	return {
		slug,
		title: slug.split('/').pop() ?? slug,
		wordCount: 100,
		minutes: 1,
		hasCode: false,
		hasMath: false,
		hasMermaid: false,
		hasQuiz: false
	};
}

/** 把一个关卡的全部题目标成已掌握 */
function masteredSchedule(levelId: string): ScheduleView {
	const level = getLevel(levelId);
	if (!level) throw new Error(`测试固定装置引用了不存在的关卡：${levelId}`);
	const view: ScheduleView = {};
	for (const q of level.questions) view[q.id] = { box: MAX_BOX, dueAt: 0 };
	return view;
}

/** 只答对一道题，制造「在学」状态 */
function partialSchedule(levelId: string): ScheduleView {
	const level = getLevel(levelId);
	if (!level) throw new Error(`测试固定装置引用了不存在的关卡：${levelId}`);
	return { [level.questions[0].id]: { box: 1, dueAt: 0 } };
}

const KV_NOTE = notesForLevel('kv-cache')[0];
/** backprop 有两篇背景笔记，用来验证题目不被重复计数 */
const BP_NOTES = notesForLevel('backprop');
const PLAIN_NOTE = '01-machine-learning/数学基础/01-线性代数';

describe('单篇笔记的状态裁决', () => {
	it('无配套关卡时只有已读信号', () => {
		const inputs = { read: new Set([PLAIN_NOTE]), schedule: {} };
		const p = noteProgress(note(PLAIN_NOTE), inputs);
		expect(p.gradable).toBeNull();
		expect(p.state).toBe('read');
	});

	it('无配套关卡且未读时是未开始', () => {
		const p = noteProgress(note(PLAIN_NOTE), { read: new Set(), schedule: {} });
		expect(p.state).toBe('untouched');
	});

	it('冲突态一：已读但一道题没做 —— 结论是已读，不谎报掌握', () => {
		const p = noteProgress(note(KV_NOTE), { read: new Set([KV_NOTE]), schedule: {} });
		expect(p.read).toBe(true);
		expect(p.gradable?.untouched).toBe(p.gradable?.total);
		expect(p.state).toBe('read');
	});

	it('冲突态二：题全做对但没点已读 —— 结论是已掌握，不因为没点按钮回退', () => {
		const p = noteProgress(note(KV_NOTE), {
			read: new Set(),
			schedule: masteredSchedule('kv-cache')
		});
		expect(p.read).toBe(false);
		expect(p.state).toBe('mastered');
	});

	it('答了一部分是在学，与已读状态无关', () => {
		const schedule = partialSchedule('kv-cache');
		for (const read of [new Set<string>(), new Set([KV_NOTE])]) {
			expect(noteProgress(note(KV_NOTE), { read, schedule }).state).toBe('in-progress');
		}
	});

	it('原始的已读信号始终保留，界面仍可单独展示', () => {
		const p = noteProgress(note(KV_NOTE), {
			read: new Set([KV_NOTE]),
			schedule: masteredSchedule('kv-cache')
		});
		expect(p.read).toBe(true);
		expect(p.state).toBe('mastered');
	});
});

describe('Tier A 题目参与状态裁决', () => {
	/**
	 * 线上实测抓到的缺陷：入门准备 4 篇有 Tier A 题但**没有配套关卡**，
	 * 而当时的实现只看关卡，于是「题全答对了，列表里仍显示未开始」。
	 * 这一组把那个组合钉住。
	 */
	const TIER_A = { [PLAIN_NOTE]: ['note:x-q1', 'note:x-q2'] };

	it('无关卡但有 Tier A 题：未作答时是未开始', () => {
		const p = noteProgress(note(PLAIN_NOTE), {
			read: new Set(),
			schedule: {},
			noteQuestionIds: TIER_A
		});
		expect(p.gradable?.total).toBe(2);
		expect(p.state).toBe('untouched');
	});

	it('无关卡但有 Tier A 题：答对一道就是在学，不再是未开始', () => {
		const p = noteProgress(note(PLAIN_NOTE), {
			read: new Set(),
			schedule: { 'note:x-q1': { box: 1, dueAt: 0 } },
			noteQuestionIds: TIER_A
		});
		expect(p.state).toBe('in-progress');
	});

	it('无关卡但有 Tier A 题：全部掌握即已掌握，不需要点已读', () => {
		const p = noteProgress(note(PLAIN_NOTE), {
			read: new Set(),
			schedule: {
				'note:x-q1': { box: MAX_BOX, dueAt: 0 },
				'note:x-q2': { box: MAX_BOX, dueAt: 0 }
			},
			noteQuestionIds: TIER_A
		});
		expect(p.state).toBe('mastered');
		expect(p.read).toBe(false);
	});

	it('既有 Tier A 题又有配套关卡时两者合并计算', () => {
		const level = getLevel('kv-cache');
		const p = noteProgress(note(KV_NOTE), {
			read: new Set(),
			schedule: {},
			noteQuestionIds: { [KV_NOTE]: ['note:kv-q1'] }
		});
		expect(p.gradable?.total).toBe((level?.questions.length ?? 0) + 1);
	});

	it('模块汇总把笔记自带的题计入总数', () => {
		const manifest: NotesManifest = {
			generatedAt: '',
			count: 1,
			modules: [
				{
					id: 'm',
					label: 'M',
					notes: 1,
					sections: [{ dir: '', section: '', notes: [note(PLAIN_NOTE)] }]
				}
			]
		};
		const summary = moduleProgress(buildCurriculum(manifest).modules[0], {
			read: new Set(),
			schedule: { 'note:x-q1': { box: MAX_BOX, dueAt: 0 } },
			noteQuestionIds: TIER_A
		});
		expect(summary.gradableNotes).toBe(1);
		expect(summary.questions.total).toBe(2);
		expect(summary.questions.mastered).toBe(1);
	});
});

describe('模块汇总', () => {
	const manifest: NotesManifest = {
		generatedAt: '',
		count: 3,
		modules: [
			{
				id: 'm',
				label: '测试模块',
				notes: 3,
				sections: [{ dir: '01-s', section: 's', notes: [...BP_NOTES.map(note), note(PLAIN_NOTE)] }]
			}
		]
	};
	const curriculum = buildCurriculum(manifest);
	const mod = curriculum.modules[0];

	it('已读数与掌握数分别统计，互不覆盖', () => {
		const summary = moduleProgress(mod, {
			read: new Set([PLAIN_NOTE]),
			schedule: masteredSchedule('backprop')
		});
		expect(summary.noteCount).toBe(3);
		// 只点了普通篇目的已读
		expect(summary.readCount).toBe(1);
		// backprop 的两篇都有可判定内容且都已掌握
		expect(summary.gradableNotes).toBe(BP_NOTES.length);
		expect(summary.masteredNotes).toBe(BP_NOTES.length);
	});

	it('一关配多篇笔记时题目只计一次，不重复放大总数', () => {
		const level = getLevel('backprop');
		const summary = moduleProgress(mod, {
			read: new Set(),
			schedule: masteredSchedule('backprop')
		});
		expect(BP_NOTES.length).toBeGreaterThan(1);
		expect(summary.questions.total).toBe(level?.questions.length);
		expect(summary.questions.mastered).toBe(level?.questions.length);
	});

	it('没有任何信号时全为零', () => {
		const summary = moduleProgress(mod, { read: new Set(), schedule: {} });
		expect(summary.readCount).toBe(0);
		expect(summary.masteredNotes).toBe(0);
		expect(summary.questions.mastered).toBe(0);
		expect(summary.questions.total).toBeGreaterThan(0);
	});

	it('全站汇总逐模块给出结果', () => {
		const all = curriculumProgress(curriculum, { read: new Set(), schedule: {} });
		expect(all.length).toBe(1);
		expect(all[0].moduleId).toBe('m');
	});
});
