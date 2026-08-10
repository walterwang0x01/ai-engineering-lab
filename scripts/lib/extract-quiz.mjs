/**
 * Tier A 可判定题的抽取与校验。
 *
 * 被 `scripts/sync-notes.mjs`（构建期）和 `src/lib/notes/extract-quiz.spec.ts`
 * （单元测试）共用，避免两份实现漂移——与 `src/lib/python/harness.ts` 同样的理由。
 *
 * ## 为什么只支持选择题
 *
 * Tier A 要覆盖 168 篇笔记，靠的是「作者写笔记时顺手出题」。这一层**刻意排除数值题**：
 * AGENTS.md 的硬门禁要求每道数值题都有测试用独立公式重算答案，那是人工领域工作，
 * 无法在抽取管道里自动完成。放开数值题就等于把「可能算错的数字」批量发出去。
 *
 * 判定引擎 `judge()` 也只处理 numeric 和 choice，选择题的判定是结构性的
 * （选项枚举明确），不需要额外的判定代码。
 *
 * ## 作者侧格式
 *
 * 在笔记 markdown 里写一个 ```ael-quiz 围栏块，内容是 JSON 数组：
 *
 * ```ael-quiz
 * [
 *   {
 *     "id": "kv-growth",
 *     "prompt": "KV Cache 显存随序列长度如何增长？",
 *     "options": ["线性", "平方", "常数"],
 *     "answerIndex": 0,
 *     "explanation": "每个 token 各存一份 K 和 V，所以是线性。",
 *     "reviewed": true
 *   }
 * ]
 * ```
 *
 * 选 JSON 而不是 YAML：不引新依赖，且格式错误能给出精确定位。
 * 用围栏块而不是 HTML 注释：作者在任何 markdown 预览里都能看见自己写的题。
 *
 * ## reviewed 门禁
 *
 * `reviewed` 必须显式为 `true` 才会进产物。LLM 起草的题一律先写 `false`，
 * 人工逐题过审后才翻转。未过审的内容在物理上到不了线上。
 */

/** 围栏块的语言标记 */
const FENCE_TAG = 'ael-quiz';

/** 局部 id 的合法字符：小写字母、数字、连字符 */
const LOCAL_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 允许出现的字段。多余字段一律报错，用来抓 answerIdx 这类拼写错误 */
const ALLOWED_KEYS = new Set([
	'id',
	'kind',
	'prompt',
	'options',
	'answerIndex',
	'explanation',
	'hint',
	'distractorNotes',
	'reviewed'
]);

/**
 * 一条校验问题。
 * @typedef {{ where: string, problem: string }} QuizIssue
 */

/**
 * 抽取结果。
 * @typedef {{
 *   questions: import('../../src/lib/quiz/types').ChoiceQuestion[],
 *   drafts: number,
 *   issues: QuizIssue[]
 * }} ExtractResult
 */

/**
 * 一篇笔记的 id 命名空间。
 *
 * 用 `note:` 前缀而不是直接用 slug：进度存储是全站单一命名空间，
 * 这个前缀保证笔记题永远不可能和关卡题（`kv-cache-01-…`）撞车。
 *
 * @param {string} slug
 * @returns {string}
 */
export function noteNamespace(slug) {
	return `note:${slug}`;
}

/**
 * 从 markdown 里取出全部 ael-quiz 块的原始文本。
 *
 * 用行扫描而不是单个正则：正则跨围栏匹配在嵌套代码块面前很容易吃掉多余内容，
 * 而笔记里出现「示例中展示一个 ael-quiz 块」是完全可能的。
 *
 * @param {string} markdown
 * @returns {string[]} 每个块的内容（不含围栏行）
 */
export function findQuizBlocks(markdown) {
	/** @type {string[]} */
	const blocks = [];
	const lines = markdown.split(/\r?\n/);

	let inBlock = false;
	/** @type {string[]} */
	let buffer = [];
	/** 围栏的反引号数量，闭合时必须不少于开启时 */
	let fenceLen = 0;

	for (const line of lines) {
		const fence = /^(`{3,})\s*([A-Za-z0-9_-]*)\s*$/.exec(line);

		if (!inBlock) {
			if (fence && fence[2] === FENCE_TAG) {
				inBlock = true;
				fenceLen = fence[1].length;
				buffer = [];
			}
			continue;
		}

		if (fence && fence[1].length >= fenceLen && fence[2] === '') {
			blocks.push(buffer.join('\n'));
			inBlock = false;
			continue;
		}
		buffer.push(line);
	}

	// 未闭合的块直接丢弃，交给调用方通过「块数不符」发现——
	// 这里不静默补齐，半个块解析出来的题目更危险
	return blocks;
}

/**
 * 校验并规范化一道题。
 *
 * @param {unknown} raw
 * @param {string} slug
 * @param {string} where 出错位置描述
 * @returns {{ question: import('../../src/lib/quiz/types').ChoiceQuestion | null, reviewed: boolean, issues: QuizIssue[] }}
 */
function normalizeQuestion(raw, slug, where) {
	/** @type {QuizIssue[]} */
	const issues = [];
	const add = (/** @type {string} */ problem) => issues.push({ where, problem });

	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		add('题目必须是 JSON 对象');
		return { question: null, reviewed: false, issues };
	}

	const obj = /** @type {Record<string, unknown>} */ (raw);

	for (const key of Object.keys(obj)) {
		if (!ALLOWED_KEYS.has(key)) add(`未知字段 "${key}"（拼写错误？）`);
	}

	if (obj.kind !== undefined && obj.kind !== 'choice') {
		add(
			`kind 只能是 "choice"。数值题必须写在关卡题库里，` +
				`因为 AGENTS.md 要求每道数值题都有独立重算测试，抽取管道无法代替那一步`
		);
	}

	const localId = obj.id;
	if (typeof localId !== 'string' || !LOCAL_ID_RE.test(localId)) {
		add(`id 必须是小写字母数字连字符组成的字符串，实际是 ${JSON.stringify(localId)}`);
	}

	if (typeof obj.prompt !== 'string' || obj.prompt.trim() === '') add('prompt 为空');
	if (typeof obj.explanation !== 'string' || obj.explanation.trim() === '') add('explanation 为空');

	const options = obj.options;
	if (!Array.isArray(options) || options.length < 2) {
		add('options 至少要有 2 个');
	} else {
		if (options.some((o) => typeof o !== 'string' || o.trim() === '')) add('存在空选项');
		if (new Set(options).size !== options.length) add('存在重复选项');
	}

	const answerIndex = obj.answerIndex;
	if (typeof answerIndex !== 'number' || !Number.isInteger(answerIndex)) {
		add('answerIndex 必须是整数');
	} else if (Array.isArray(options) && (answerIndex < 0 || answerIndex >= options.length)) {
		add(`answerIndex ${answerIndex} 超出选项范围`);
	}

	if (obj.hint !== undefined && (typeof obj.hint !== 'string' || obj.hint.trim() === '')) {
		add('hint 存在但为空');
	}

	if (obj.distractorNotes !== undefined) {
		const notes = obj.distractorNotes;
		if (typeof notes !== 'object' || notes === null || Array.isArray(notes)) {
			add('distractorNotes 必须是「选项下标 → 解释」的对象');
		} else {
			for (const [key, value] of Object.entries(notes)) {
				const idx = Number(key);
				if (!Number.isInteger(idx)) add(`distractorNotes 的键 "${key}" 不是整数下标`);
				else if (Array.isArray(options) && (idx < 0 || idx >= options.length)) {
					add(`distractorNotes 的下标 ${idx} 超出选项范围`);
				} else if (idx === answerIndex) {
					add('distractorNotes 不应包含正确答案的下标');
				}
				if (typeof value !== 'string' || value.trim() === '') {
					add(`distractorNotes[${key}] 为空`);
				}
			}
		}
	}

	// reviewed 必须显式给出。默认放行等于把未过审内容当成已过审
	if (typeof obj.reviewed !== 'boolean') {
		add('reviewed 必须显式写成 true 或 false');
	}

	if (issues.length > 0) return { question: null, reviewed: false, issues };

	/** @type {import('../../src/lib/quiz/types').ChoiceQuestion} */
	const question = {
		kind: 'choice',
		id: `${noteNamespace(slug)}-${String(localId)}`,
		prompt: String(obj.prompt).trim(),
		options: /** @type {string[]} */ (options).map((o) => String(o).trim()),
		answerIndex: Number(answerIndex),
		explanation: String(obj.explanation).trim()
	};
	if (typeof obj.hint === 'string') question.hint = obj.hint.trim();
	if (obj.distractorNotes) {
		/** @type {Record<number, string>} */
		const dn = {};
		for (const [key, value] of Object.entries(obj.distractorNotes)) {
			dn[Number(key)] = String(value).trim();
		}
		question.distractorNotes = dn;
	}

	return { question, reviewed: obj.reviewed === true, issues };
}

/**
 * 解析一篇笔记的全部题目。
 *
 * @param {string} slug
 * @param {string} markdown
 * @returns {ExtractResult}
 */
export function extractNoteQuestions(slug, markdown) {
	const blocks = findQuizBlocks(markdown);
	/** @type {unknown[]} */
	const raws = [];
	/** @type {QuizIssue[]} */
	const issues = [];

	for (const [i, block] of blocks.entries()) {
		const where = `${slug} 第 ${i + 1} 个 ael-quiz 块`;
		let parsed;
		try {
			parsed = JSON.parse(block);
		} catch (e) {
			issues.push({ where, problem: `JSON 解析失败：${e instanceof Error ? e.message : e}` });
			continue;
		}
		if (!Array.isArray(parsed)) {
			issues.push({ where, problem: 'ael-quiz 块的内容必须是 JSON 数组' });
			continue;
		}
		raws.push(...parsed);
	}

	return finalize(slug, raws, issues, 'ael-quiz 块');
}

/**
 * 校验一组原始题目并产出最终题库。本地 JSON 与 markdown 块共用这一段。
 *
 * @param {string} slug
 * @param {unknown[]} raws
 * @param {QuizIssue[]} issues
 * @param {string} source 来源描述，用于报错
 * @returns {ExtractResult}
 */
function finalize(slug, raws, issues, source) {
	/** @type {import('../../src/lib/quiz/types').ChoiceQuestion[]} */
	const questions = [];
	const seen = new Set();
	let drafts = 0;

	for (const [i, raw] of raws.entries()) {
		const where = `${slug} ${source} 第 ${i + 1} 题`;
		const { question, reviewed, issues: qIssues } = normalizeQuestion(raw, slug, where);
		issues.push(...qIssues);
		if (!question) continue;

		if (seen.has(question.id)) {
			issues.push({ where, problem: `id 重复：${question.id}` });
			continue;
		}
		seen.add(question.id);

		// 未过审的只计数，不进产物
		if (!reviewed) {
			drafts += 1;
			continue;
		}
		questions.push(question);
	}

	return { questions, drafts, issues };
}

/**
 * 解析本地维护的题目 JSON（`content/note-questions/<slug>.json`）。
 *
 * 为什么需要这条路径：笔记正文来自另一个仓库，CI 是从 GitHub 拉的，
 * 本地还没推送的笔记改动在 CI 里看不到。练习场自己维护的题目放在本仓库，
 * 才能和代码一起被门禁校验、一起进 CI。两条来源走同一套 schema 和同一道校验。
 *
 * @param {string} slug
 * @param {string} json 文件内容
 * @returns {ExtractResult}
 */
export function parseLocalQuestions(slug, json) {
	/** @type {QuizIssue[]} */
	const issues = [];
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch (e) {
		issues.push({
			where: `content/note-questions/${slug}.json`,
			problem: `JSON 解析失败：${e instanceof Error ? e.message : e}`
		});
		return { questions: [], drafts: 0, issues };
	}
	if (!Array.isArray(parsed)) {
		issues.push({
			where: `content/note-questions/${slug}.json`,
			problem: '文件内容必须是 JSON 数组'
		});
		return { questions: [], drafts: 0, issues };
	}
	return finalize(slug, parsed, issues, '本地题库');
}

/**
 * 合并两个来源的题目。id 冲突算错误——同一篇的题只应有一个权威来源。
 *
 * @param {string} slug
 * @param {ExtractResult} inline
 * @param {ExtractResult} local
 * @returns {ExtractResult}
 */
export function mergeSources(slug, inline, local) {
	const issues = [...inline.issues, ...local.issues];
	const byId = new Map(inline.questions.map((q) => [q.id, q]));

	for (const q of local.questions) {
		if (byId.has(q.id)) {
			issues.push({
				where: slug,
				problem: `题目 id "${q.id}" 同时出现在笔记正文和本地题库里，来源必须唯一`
			});
			continue;
		}
		byId.set(q.id, q);
	}

	return {
		questions: [...byId.values()],
		drafts: inline.drafts + local.drafts,
		issues
	};
}
