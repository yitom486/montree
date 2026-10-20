/** Markdown 预览与在线文档阅读共用的代码块工具栏 HTML */

export const CODE_BLOCK_COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`

export function escapeCodeBlockLangLabel(lang: string): string {
  return lang
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildCodeBlockCopyButtonHtml(): string {
  return `<button type="button" class="code-block-copy" aria-label="复制代码" title="复制代码">${CODE_BLOCK_COPY_ICON_SVG}</button>`
}

export function buildCodeBlockToolbarHtml(lang: string, filename?: string): string {
  const label = escapeCodeBlockLangLabel(lang || 'text')
  const file = filename?.trim()
  const filenameHtml = file
    ? `<span class="code-block-filename" title="${escapeCodeBlockLangLabel(file)}">${escapeCodeBlockLangLabel(file)}</span>`
    : ''
  return [
    '<div class="code-block-toolbar">',
    `<span class="code-block-labels">${filenameHtml}<span class="code-block-lang">${label}</span></span>`,
    buildCodeBlockCopyButtonHtml(),
    '</div>',
  ].join('')
}
