import { describe, expect, it } from 'vitest';
import { renderInline, renderInlineParagraphs, renderProse } from './inline-markdown';
import { LEVELS } from '$lib/levels/registry';

/**
 * 行内 Markdown 渲染的门禁。
 *
 * 最后一组是重点：它遍历全站题库，断言渲染后**不残留任何字面 `**`**。
 * 这正是零上下文复查抓到的严重度 3 缺陷——屏幕上显示 `= **5**`，
 * 而且每道题加粗的那行恰好是答案行。
 */

describe('渲染两种标记', () => {
	it('粗体', () => {
		expect(renderInline('答案是 **5**')).toBe('答案是 <strong>5</strong>');
	});

	it('行内代码', () => {
		expect(renderInline('公式 `w ← w − η·∂L/∂w`')).toBe('公式 <code>w ← w − η·∂L/∂w</code>');
	});

	it('同一行里两者共存', () => {
		expect(renderInline('`z2` 的梯度是 **0**')).toBe('<code>z2</code> 的梯度是 <strong>0</strong>');
	});

	it('一行里多处粗体各自闭合', () => {
		expect(renderInline('**a** 和 **b**')).toBe('<strong>a</strong> 和 <strong>b</strong>');
	});

	it('代码里的星号不被当成粗体标记', () => {
		expect(renderInline('`a ** b`')).toBe('<code>a ** b</code>');
	});
});

describe('安全性：先转义再替换', () => {
	it('HTML 被转义，不会执行', () => {
		expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
	});

	it('引号与 & 也转义', () => {
		expect(renderInline(`他说 "a & b's"`)).toBe('他说 &quot;a &amp; b&#39;s&quot;');
	});

	it('标记内部的 HTML 同样被转义', () => {
		expect(renderInline('**<b>x</b>**')).toBe('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
	});
});

describe('未闭合的标记原样保留', () => {
	it('单个 ** 不吞掉后文', () => {
		expect(renderInline('**未闭合的强调')).toBe('**未闭合的强调');
	});

	it('段落内的软换行被折叠，所以跨行的粗体仍能匹配', () => {
		// 源码里的换行只是 TS 字面量的行宽限制，渲染结果里应该消失
		expect(renderInline('**a\nb**')).toBe('<strong>a b</strong>');
	});
});

describe('中英混排的软换行折叠', () => {
	it('中文两侧折叠成空，不插入原文没有的空格', () => {
		expect(renderInline('价格比，\n与请求量无关')).toBe('价格比，与请求量无关');
	});

	it('英文两侧折叠成空格，单词不会粘在一起', () => {
		expect(renderInline('cache hit\nratio matters')).toBe('cache hit ratio matters');
	});

	it('题库里那条真实的跨行粗体能正确渲染', () => {
		const real =
			'这个结论可以推广：**只要 token 数相同，缓存节省的倍数只取决于价格比，\n与请求量、文档长度都无关**——';
		const html = renderInline(real);
		expect(html).toContain('<strong>');
		expect(html).not.toContain('**');
	});
});

describe('段落切分', () => {
	it('按空行切段并去掉空段', () => {
		expect(renderInlineParagraphs('一段 **粗**\n\n\n二段')).toEqual([
			'一段 <strong>粗</strong>',
			'二段'
		]);
	});
});

describe('围栏代码块', () => {
	it('```python 块被识别为 code 且保留语言标记', () => {
		const blocks = renderProse('前言\n\n```python\nx = 1\n```\n\n后记');
		expect(blocks.map((b) => b.kind)).toEqual(['p', 'code', 'p']);
		expect(blocks[1].lang).toBe('python');
		expect(blocks[1].html).toBe('x = 1');
	});

	it('代码块内容被转义，且不做行内替换', () => {
		const blocks = renderProse('```python\nif a < b and c ** 2:\n    pass\n```');
		expect(blocks[0].html).toContain('&lt;');
		expect(blocks[0].html).toContain('**');
		expect(blocks[0].html).not.toContain('<strong>');
	});

	it('未闭合的围栏当作代码块收尾，不把剩余内容当段落', () => {
		const blocks = renderProse('```python\nx = 1');
		expect(blocks.map((b) => b.kind)).toEqual(['code']);
	});

	it('没有围栏时行为与逐段渲染一致', () => {
		expect(renderProse('一段 **粗**\n\n二段').map((b) => b.html)).toEqual(
			renderInlineParagraphs('一段 **粗**\n\n二段')
		);
	});
});

describe('全站题库渲染后不残留字面标记', () => {
	/** 题库里所有会被渲染的文案字段 */
	function proseFields(): { id: string; field: string; text: string }[] {
		const out: { id: string; field: string; text: string }[] = [];
		for (const level of LEVELS) {
			for (const q of level.questions) {
				out.push({ id: q.id, field: 'explanation', text: q.explanation });
				if (q.hint) out.push({ id: q.id, field: 'hint', text: q.hint });
				if (q.kind === 'choice' && q.distractorNotes) {
					for (const [k, v] of Object.entries(q.distractorNotes)) {
						out.push({ id: q.id, field: `distractorNotes[${k}]`, text: v });
					}
				}
			}
		}
		return out;
	}

	/**
	 * 只取**散文部分**的渲染结果。
	 *
	 * 代码块里的 `**` 是 Python 的幂运算符（`c ** 2`），是合法代码而不是漏出的标记，
	 * 所以门禁必须排除 code 块——否则它会把正确的代码报成缺陷。
	 */
	function renderField(f: { field: string; text: string }): string {
		return f.field === 'explanation'
			? renderProse(f.text)
					.filter((b) => b.kind === 'p')
					.map((b) => b.html)
					.join('\n')
			: renderInline(f.text);
	}

	it('渲染后没有任何字面 ** 漏到界面上', () => {
		const leaks = proseFields()
			.map((f) => ({ ...f, html: renderField(f) }))
			.filter((f) => f.html.includes('**'));
		expect(
			leaks.map((f) => `${f.id} 的 ${f.field}: ${f.html.slice(0, 120)}`),
			'这些文案里有未闭合的粗体标记，会在界面上显示成字面星号'
		).toEqual([]);
	});

	it('渲染后没有任何字面反引号漏到界面上', () => {
		const leaks = proseFields()
			.map((f) => ({ ...f, html: renderField(f) }))
			.filter((f) => f.html.includes('`'));
		expect(leaks.map((f) => `${f.id} 的 ${f.field}`)).toEqual([]);
	});

	it('题库里确实用了这些标记 —— 否则这组门禁是空转的', () => {
		const marked = proseFields().filter((f) => f.text.includes('**') || f.text.includes('`'));
		expect(marked.length).toBeGreaterThan(20);
	});
});
