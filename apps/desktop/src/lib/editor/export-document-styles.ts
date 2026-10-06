/**
 * 导出专用样式：固定浅色纸张主题（不依赖应用 CSS 变量），
 * 对齐 GitHub / 应用内预览的层次与代码高亮观感。
 */
export const EXPORT_DOCUMENT_STYLES = `
@page {
  size: A4;
  margin: 18mm 16mm;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  margin: 0;
  padding: 0;
  color: #1f2328;
  background: #ffffff;
  font-family:
    "Segoe UI",
    "Microsoft YaHei UI",
    "Microsoft YaHei",
    "PingFang SC",
    "Noto Sans SC",
    "Hiragino Sans GB",
    sans-serif;
  font-size: 11pt;
  line-height: 1.75;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}

.markdown-preview {
  max-width: 100%;
  margin: 0;
  padding: 0;
}

.markdown-preview > :first-child {
  margin-top: 0 !important;
}

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6 {
  color: #1f2328;
  font-weight: 650;
  line-height: 1.3;
  page-break-after: avoid;
  break-after: avoid-page;
}

.markdown-preview h1 {
  margin: 0 0 0.8em;
  padding-bottom: 0.3em;
  font-size: 1.75rem;
  border-bottom: 1px solid #d0d7de;
}

.markdown-preview h2 {
  margin: 1.6em 0 0.7em;
  padding-bottom: 0.3em;
  font-size: 1.4rem;
  border-bottom: 1px solid #d8dee4;
}

.markdown-preview h3 {
  margin: 1.35em 0 0.55em;
  font-size: 1.2rem;
}

.markdown-preview h4 {
  margin: 1.2em 0 0.45em;
  font-size: 1.05rem;
}

.markdown-preview h5,
.markdown-preview h6 {
  margin: 1.1em 0 0.4em;
  font-size: 0.95rem;
}

.markdown-preview p,
.markdown-preview ul,
.markdown-preview ol,
.markdown-preview pre,
.markdown-preview blockquote {
  margin: 0.85em 0;
}

.markdown-preview ul,
.markdown-preview ol {
  padding-left: 1.6em;
}

.markdown-preview ul {
  list-style: disc;
}

.markdown-preview ol {
  list-style: decimal;
}

.markdown-preview li + li {
  margin-top: 0.25em;
}

.markdown-preview li > ul,
.markdown-preview li > ol {
  margin: 0.35em 0;
}

.markdown-preview blockquote {
  margin: 1em 0;
  padding: 0.15em 0 0.15em 1em;
  color: #656d76;
  border-left: 0.25em solid #d0d7de;
}

.markdown-preview blockquote > :first-child {
  margin-top: 0;
}

.markdown-preview blockquote > :last-child {
  margin-bottom: 0;
}

.markdown-preview a {
  color: #0969da;
  text-decoration: none;
}

.markdown-preview a:hover {
  text-decoration: underline;
}

.markdown-preview hr {
  height: 0.2em;
  margin: 1.6em 0;
  padding: 0;
  border: 0;
  background: #d0d7de;
}

.markdown-preview strong {
  font-weight: 700;
}

.markdown-preview em {
  font-style: italic;
}

.markdown-preview code {
  font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, "Courier New", monospace;
  font-size: 0.875em;
  padding: 0.15em 0.4em;
  border-radius: 0.3em;
  background: rgba(175, 184, 193, 0.22);
  color: #1f2328;
}

.markdown-preview pre {
  overflow: auto;
  padding: 0.9em 1em;
  border-radius: 0.45em;
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  page-break-inside: avoid;
  break-inside: avoid;
}

.markdown-preview pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
  font-size: 0.84em;
  line-height: 1.55;
  color: #1f2328;
}

.markdown-preview .code-block {
  margin: 1em 0;
  overflow: hidden;
  border: 1px solid #d0d7de;
  border-radius: 0.5em;
  background: #f6f8fa;
  page-break-inside: avoid;
  break-inside: avoid;
}

.markdown-preview .code-block-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.7rem;
  border-bottom: 1px solid #d8dee4;
  background: #eef1f4;
}

.markdown-preview .code-block-lang {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 600;
  color: #656d76;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.markdown-preview .code-block-copy {
  display: none !important;
}

.markdown-preview .code-block-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
}

.markdown-preview .code-block-lines {
  display: flex;
  flex-direction: column;
  padding: 0.9rem 0.55rem;
  border-right: 1px solid #d8dee4;
  background: #eef2f5;
  text-align: right;
  user-select: none;
}

.markdown-preview .code-block-line-number {
  display: block;
  min-width: 1.4rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.55;
  color: #8c959f;
}

.markdown-preview .code-block pre {
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0.9rem 1rem;
}

.markdown-preview .code-block pre code.hljs,
.markdown-preview pre code.hljs {
  display: block;
  overflow-x: auto;
  padding: 0;
  background: transparent;
  font-size: 0.84rem;
  line-height: 1.55;
}

.markdown-preview .mermaid {
  margin: 1em 0;
  padding: 0.9em 1em;
  border: 1px dashed #d0d7de;
  border-radius: 0.45em;
  background: #f6f8fa;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.84em;
  color: #656d76;
  page-break-inside: avoid;
  break-inside: avoid;
}

.markdown-preview img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.9em 0;
  border: 1px solid #d0d7de;
  border-radius: 0.4em;
  background: #ffffff;
  page-break-inside: avoid;
  break-inside: avoid;
}

.markdown-preview table {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  display: table;
  page-break-inside: avoid;
  break-inside: avoid;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid #d0d7de;
  padding: 0.45em 0.7em;
  text-align: left;
  vertical-align: top;
}

.markdown-preview th {
  background: #f6f8fa;
  font-weight: 650;
}

.markdown-preview tbody tr:nth-child(even) {
  background: #fafbfc;
}

.markdown-preview ul.contains-task-list {
  padding-left: 0.2em;
  list-style: none;
}

.markdown-preview li.task-list-item {
  display: flex;
  align-items: flex-start;
  gap: 0.45em;
  list-style: none;
}

.markdown-preview li.task-list-item input[type='checkbox'] {
  margin-top: 0.4em;
  accent-color: #0969da;
}

.markdown-preview .katex {
  font-size: 1.05em;
  line-height: normal;
}

.markdown-preview p:has(> .katex),
.markdown-preview p:has(.katex),
.markdown-preview li:has(.katex) {
  line-height: 1.95;
}

.markdown-preview .katex-display {
  margin: 1.1em 0;
  padding: 0.35em 0;
  overflow-x: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}

/* highlight.js GitHub light tokens */
.hljs {
  color: #1f2328;
  background: transparent;
}
.hljs-doctag,
.hljs-keyword,
.hljs-meta .hljs-keyword,
.hljs-template-tag,
.hljs-template-variable,
.hljs-type,
.hljs-variable.language_ {
  color: #cf222e;
}
.hljs-title,
.hljs-title.class_,
.hljs-title.class_.inherited__,
.hljs-title.function_ {
  color: #8250df;
}
.hljs-attr,
.hljs-attribute,
.hljs-literal,
.hljs-meta,
.hljs-number,
.hljs-operator,
.hljs-selector-attr,
.hljs-selector-class,
.hljs-selector-id,
.hljs-variable {
  color: #0550ae;
}
.hljs-meta .hljs-string,
.hljs-regexp,
.hljs-string {
  color: #0a3069;
}
.hljs-built_in,
.hljs-symbol {
  color: #953800;
}
.hljs-code,
.hljs-comment,
.hljs-formula {
  color: #6e7781;
}
.hljs-name,
.hljs-quote,
.hljs-selector-pseudo,
.hljs-selector-tag {
  color: #116329;
}
.hljs-subst {
  color: #1f2328;
}
.hljs-section {
  color: #0550ae;
  font-weight: 700;
}
.hljs-bullet {
  color: #953800;
}
.hljs-emphasis {
  color: #1f2328;
  font-style: italic;
}
.hljs-strong {
  color: #1f2328;
  font-weight: 700;
}
.hljs-addition {
  color: #116329;
  background-color: #dafbe1;
}
.hljs-deletion {
  color: #82071e;
  background-color: #ffebe9;
}

/* OCR 页标记 chip（与应用内预览同形；固定浅色纸张主题） */
.markdown-preview .montree-page-marker {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.25rem 0;
  color: #6e7781;
  font-size: 9pt;
}
.markdown-preview .montree-page-marker::before,
.markdown-preview .montree-page-marker::after {
  content: '';
  flex: 1;
  border-top: 1px dashed #d0d7de;
}
`

/** 导出前去掉交互控件，避免 PDF 里出现复制按钮占位 */
export function stripExportChrome(html: string): string {
  return html
    .replace(/<button\b[^>]*class="[^"]*code-block-copy[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/\saria-label="复制代码"/gi, '')
}
