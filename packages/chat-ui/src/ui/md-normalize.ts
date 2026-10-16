/**
 * 聊天 Markdown 纯字符预处理（私有模块，不进 barrel）。
 * 整搬自宿主，行为逐字不变：
 * - `normalizeLatexDelimiters` ← `apps/desktop/src/lib/editor/latex-delimiters.ts`
 *  （含其私有用到的全部 helper，仅裁掉本文件未使用的 `patchStreamingMathDelimiters`）
 * - `normalizeRawSvgDataUriImages` ← `apps/desktop/src/lib/editor/markdown.ts`
 * 两者均为纯函数，不读任何 store。
 */

const FENCE_PATTERN = /(```[\s\S]*?```)/g
const INLINE_CODE_PATTERN = /(`+[^`]*`+)/g

/** 常见数学命令；避免把 Windows 路径等 `\U`、`\t` 误判为公式。 */
const INLINE_LATEX_HINT =
  /\\(?:sim|text|ldots|frac|begin|end|cdot|times|pm|mp|leq|geq|neq|approx|alpha|beta|gamma|delta|pi|sigma|sum|prod|int|sqrt|overline|underline|vec|mathbf|mathrm|left|right|quad|qquad|cdots|infty|partial|nabla|forall|exists|in|notin|subset|supset|cup|cap|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow|to|gets)(?![a-zA-Z])|\\[a-zA-Z]+\{/

function wrapBareInlineLatexInText(text: string): string {
  return text.replace(
    /\(([^()\n]*)\)/g,
    (match, body: string) => {
      if (!INLINE_LATEX_HINT.test(body)) return match
      return `$${body}$`
    },
  )
}

/** LaTeX 块级/行内定界符 → markdown-it-katex 识别的 $ / $$ */
function normalizeLatexDelimitersInText(text: string): string {
  let result = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body}$$`)
  result = result.replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body}$`)
  // 模型偶发省略反斜杠：单独一行的 [ / ] 包裹含 LaTeX 命令的内容
  result = result.replace(
    /^\[\s*\r?\n([\s\S]*?)\r?\n\]\s*$/gm,
    (match, body: string) => (/\\[a-zA-Z]/.test(body) ? `$$${body}$$` : match),
  )
  result = wrapBareInlineLatexInText(result)
  return result
}

function normalizeLatexDelimitersInSegment(text: string): string {
  const parts = text.split(INLINE_CODE_PATTERN)
  return parts
    .map((part) => (part.startsWith('`') ? part : normalizeLatexDelimitersInText(part)))
    .join('')
}

/** 跳过 fenced code，将其余段落中的 LaTeX 定界符规范为 $ / $$ */
export function normalizeLatexDelimiters(source: string): string {
  const parts = source.split(FENCE_PATTERN)
  return parts
    .map((part) => (part.startsWith('```') ? part : normalizeLatexDelimitersInSegment(part)))
    .join('')
}

/**
 * 边界兼容：处理形如 ![alt](data:image/svg+xml;utf8,<svg...> "title") 的裸 SVG 标签语法
 * CommonMark 规范禁止 URL 内含未转义尖括号，通过规范化转为标准带编码的 <img> 标签避免解析器截断
 */
export function normalizeRawSvgDataUriImages(source: string): string {
  return source.replace(
    /!\[([^\]]*)\]\((data:image\/svg\+xml;utf8,<svg[\s\S]*?<\/svg>)(?:\s+["']([^"']*)["'])?\)/gi,
    (_match, alt, rawUri, title) => {
      const prefix = 'data:image/svg+xml;utf8,'
      const svgContent = rawUri.slice(prefix.length)
      const encoded = `${prefix}${encodeURIComponent(svgContent)}`
      const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''
      const altAttr = alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : ' alt=""'
      return `<img src="${encoded}"${altAttr}${titleAttr} />`
    },
  )
}
