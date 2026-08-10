/**
 * 题目文案的行内 Markdown 渲染。
 *
 * ## 为什么需要它
 *
 * 题库里的 explanation / hint / distractorNotes 全都用 `**粗体**` 强调关键结论，
 * 用 `` `代码` `` 标注公式与标识符——全站 91 处。而这些字段此前是当纯文本渲染的，
 * 于是屏幕上原样显示 `= **5**` 和 `` `w ← w − η·∂L/∂w` ``。
 *
 * 更糟的是：每道题加粗的那一行恰好就是最终答案那一行，所以每次公布答案，
 * 用户都会看到一次带字面星号的乱码。零上下文可用性复查把这条列为严重度 3，
 * 原话是「一个第一次来的人会直接判断'这站没做完'」。
 *
 * 修法是**渲染**而不是删标记：作者的本意就是强调，删掉标记会让答案行失去重点。
 *
 * ## 为什么不用 marked
 *
 * `lib/notes/render.ts` 里的 marked 是块级渲染器，会把一句话包成 `<p>`、
 * 处理标题列表引用等等，用在一个已经在 `<p>` 里的短句上是错的。
 * 这里要的是「一行字里的强调」，只需要两条规则。
 *
 * ## 安全性
 *
 * **先转义再替换**，顺序不能反。内容来自本仓库自有题库而非用户输入，
 * 但 Tier A 题目来自笔记源仓库的 ael-quiz 块，那已经是「外部内容」了；
 * 而且一旦顺序写反，题干里一个 `<script>` 就会被执行。转义在前是不可协商的。
 */

const ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * 把一行文案里的 `**粗体**` 与 `` `代码` `` 渲染成 HTML。
 *
 * 只支持这两种：题库里实际用到的就是这两种，多支持一种就多一条要维护的规则。
 * 未闭合的标记（`**foo`）原样保留——那是作者的笔误，显示出来才会被发现，
 * 悄悄吞掉反而让它永远藏着。
 */
/** CJK 与全角标点。用来决定折叠软换行时要不要补空格 */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * 折叠段落内的软换行。
 *
 * 源码里的换行只是为了让 TS 字面量不超行宽，在渲染结果里应该消失——
 * 这也是 Markdown 对软换行的语义。不折叠会出两个问题：
 *
 *   1. **跨行的 `**粗体**` 匹配不到**，于是星号原样漏到界面上。
 *      题库里真的有一条这样的文案（tokenizer 缓存倍数那题）。
 *   2. 行内代码同理。
 *
 * 中英混排要分别处理：英文两侧折叠成空格（否则单词会粘在一起），
 * 中文两侧折叠成空字符串（补空格会在「价格比，| 与请求量」之间插入一个
 * 原文没有的空格，这正是这个仓库反复踩过的中英混排间距问题）。
 */
function collapseSoftWraps(text: string): string {
	return text.replace(/[ \t]*\n[ \t]*/g, (_m, offset: number, whole: string) => {
		const before = whole.slice(0, offset).slice(-1);
		const after = whole
			.slice(offset)
			.replace(/^[ \t]*\n[ \t]*/, '')
			.slice(0, 1);
		if (before === '' || after === '') return '';
		return CJK.test(before) && CJK.test(after) ? '' : ' ';
	});
}

export function renderInline(text: string): string {
	const escaped = escapeHtml(collapseSoftWraps(text));

	return (
		escaped
			// 先处理行内代码：代码里的星号不该被当成粗体标记
			.replace(/`([^`\n]+)`/g, '<code>$1</code>')
			// 粗体。[^*] 保证不跨越另一个标记，避免把整段吞掉
			.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
	);
}

/**
 * 按空行切段并逐段渲染，供多段落的 explanation 使用。
 *
 * 返回段落数组而不是拼好的 HTML：调用方用 `{#each}` 生成 `<p>`，
 * 这样段落间距由 CSS 控制，而不是靠渲染器塞标签。
 */
export function renderInlineParagraphs(text: string): string[] {
	return text
		.split('\n\n')
		.map((p) => p.trim())
		.filter((p) => p !== '')
		.map(renderInline);
}

/** 一段渲染好的内容：普通段落，或一个代码块 */
export interface ProseBlock {
	kind: 'p' | 'code';
	/** 已转义并渲染好的 HTML（p），或已转义的纯代码文本（code） */
	html: string;
	/** 代码块的语言标记，仅 kind==='code' 时有意义 */
	lang?: string;
}

/**
 * 渲染一整段题目文案，支持 ``` 围栏代码块。
 *
 * ## 为什么必须支持围栏块
 *
 * 代码题的 explanation 里放的是参考解法，用 ```` ```python ```` 围栏包着——
 * 全站 9 处。只做行内渲染的话，围栏标记会原样显示成字面反引号，
 * 参考解法看起来像一坨乱码。
 *
 * ## 为什么不复用 lib/notes/render.ts 的 marked
 *
 * 那条管线带着 marked + highlight.js。笔记页本来就要加载它们，
 * 但关卡页现在完全不碰——为了 9 段参考解法给每个关卡页增加几十 KB，
 * 换不来相应的价值。代码高亮在这里也不是必需：真正要动手写的地方是
 * CodeQuestionCard 的编辑器，那里有 CodeMirror。
 *
 * 所以这里只认三种标记（围栏块、粗体、行内代码），够用且零依赖。
 */
export function renderProse(text: string): ProseBlock[] {
	const blocks: ProseBlock[] = [];
	const lines = text.split('\n');

	let inFence = false;
	let fenceLang = '';
	let buffer: string[] = [];

	const flushParagraphs = () => {
		const chunk = buffer.join('\n');
		buffer = [];
		for (const p of renderInlineParagraphs(chunk)) blocks.push({ kind: 'p', html: p });
	};

	for (const line of lines) {
		const fence = /^\s*```\s*([A-Za-z0-9_-]*)\s*$/.exec(line);

		if (!inFence && fence) {
			flushParagraphs();
			inFence = true;
			fenceLang = fence[1];
			continue;
		}
		if (inFence && fence) {
			blocks.push({ kind: 'code', html: escapeHtml(buffer.join('\n')), lang: fenceLang });
			buffer = [];
			inFence = false;
			continue;
		}
		buffer.push(line);
	}

	// 未闭合的围栏：当作代码块收尾，而不是把剩下的全部当段落
	if (inFence) {
		blocks.push({ kind: 'code', html: escapeHtml(buffer.join('\n')), lang: fenceLang });
	} else {
		flushParagraphs();
	}

	return blocks;
}
