/**
 * 关卡 ↔ 背景笔记的映射表。**人工维护，全站唯一。**
 *
 * 为什么不自动匹配标题：关卡和笔记不是一一对应的。
 * 「反向传播与死亡 ReLU」这一关的背景横跨《反向传播推导》和《激活函数》两篇，
 * 而「RAG 分块」关的分块策略在《高级 RAG 策略》里、架构背景在《RAG 架构与核心流程》里。
 * 按标题相似度自动匹配会产出看似合理但错误的关联，
 * 错误的关联比没有关联更糟——它会把用户指向读不到答案的篇目。
 *
 * 只有 5 关，人工维护的成本可以忽略，而正确性是确定的。
 *
 * 约定：
 *   - 数组第一条是 **primary**，决定关卡挂在学习路径的哪个章节
 *   - 一篇笔记只能属于一个关卡（否则笔记页反向指回关卡时有歧义）
 *   - slug 必须与 manifest 里的 slug 完全一致（不含 .md 后缀）
 *
 * 这些约定全部由 curriculum.spec.ts 做门禁，不靠自觉。
 */

/** 关卡 id → 背景笔记 slug 列表，第一条为 primary */
export const LEVEL_BACKGROUND_NOTES: Readonly<Record<string, readonly string[]>> = {
	backprop: [
		'01-machine-learning/04-神经网络原理/02-反向传播推导',
		'01-machine-learning/04-神经网络原理/04-激活函数'
	],
	tokenizer: ['02-llm/02-分词与表示/01-分词算法'],
	attention: ['02-llm/01-Transformer原理/01-注意力机制推导'],
	'kv-cache': ['02-llm/05-推理优化/01-KV-Cache与显存分析'],
	'rag-chunking': [
		'04-ai-agent/06-RAG进阶/01-RAG架构与核心流程',
		'04-ai-agent/06-RAG进阶/03-高级RAG策略'
	]
};

/**
 * slug → 关卡 id 的反向索引。
 *
 * 在模块加载时构建一次，而不是每次查询遍历映射表：
 * 笔记页渲染 168 篇的列表时会逐篇查询，O(n) 查找会变成 O(n²)。
 */
const NOTE_TO_LEVEL: ReadonlyMap<string, string> = new Map(
	Object.entries(LEVEL_BACKGROUND_NOTES).flatMap(([levelId, slugs]) =>
		slugs.map((slug) => [slug, levelId] as const)
	)
);

/** 该篇笔记对应的关卡 id，没有则 undefined */
export function levelForNote(slug: string): string | undefined {
	return NOTE_TO_LEVEL.get(slug);
}

/** 该关卡的背景笔记 slug 列表，未登记则返回空数组 */
export function notesForLevel(levelId: string): readonly string[] {
	return LEVEL_BACKGROUND_NOTES[levelId] ?? [];
}

/** 该关卡的 primary 背景笔记，决定它在学习路径里的位置。未登记则 undefined */
export function primaryNoteForLevel(levelId: string): string | undefined {
	return LEVEL_BACKGROUND_NOTES[levelId]?.[0];
}

/** 映射表登记过的全部关卡 id */
export const MAPPED_LEVEL_IDS: readonly string[] = Object.keys(LEVEL_BACKGROUND_NOTES);

/** 映射表引用的全部笔记 slug（含非 primary） */
export const MAPPED_NOTE_SLUGS: readonly string[] = [...NOTE_TO_LEVEL.keys()];
