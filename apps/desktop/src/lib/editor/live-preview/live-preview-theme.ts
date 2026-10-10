import { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'

export const livePreviewTheme = Prec.highest(EditorView.theme({
  // 现代所见即所得排版容器：采用优雅流畅的人文文档正文字体与开阔行距
  '.cm-scroller': {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif',
  },
  '.cm-content': {
    lineHeight: '1.75',
    letterSpacing: '0.01em',
    maxWidth: '960px',
    margin: '0 auto',
    flexGrow: '1',
    minWidth: '0',
  },
  '.cm-line': {
    padding: '0 24px',
  },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-live-source-block': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', backgroundColor: 'color-mix(in oklch, var(--muted) 45%, transparent)' },
  '.cm-live-block': { padding: '6px 24px', maxWidth: '100%', whiteSpace: 'normal' },
  '.cm-live-block-content': { position: 'relative', minWidth: '0' },
  '.cm-live-block-actions': { display: 'flex', justifyContent: 'flex-end', fontSize: '12px' },
  '.cm-live-block-actions button': { color: 'var(--muted-foreground)' },
  '.cm-live-source-toolbar': { padding: '4px 24px' },
  '.cm-live-block-loading': { color: 'var(--muted-foreground)', padding: '12px 0' },
  '.cm-live-block table': { display: 'table', width: '100%', margin: '4px 0 12px' },
  '.cm-live-block-content > div:last-child': { overflowX: 'auto' },
  '.cm-live-block th, .cm-live-block td': { cursor: 'text' },
  '.cm-live-block td:hover, .cm-live-block th:hover': { backgroundColor: 'color-mix(in oklch, var(--primary) 7%, transparent)' },
  '.cm-live-block .code-block': { marginTop: '4px' },
  '.cm-line:has(.cm-live-h1), .cm-line:has(.cm-live-h2)': { paddingTop: '0.55em', paddingBottom: '0.3em' },

  // 标题层级排版（覆盖底层代码高亮红绿配色，确保正文级统一稳重观感）
  '.cm-live-h1': {
    fontSize: '1.85em',
    fontWeight: '750',
    lineHeight: '1.3',
    display: 'inline',
    color: 'var(--foreground) !important',
    letterSpacing: '-0.025em',
  },
  '.cm-live-h2': {
    fontSize: '1.45em',
    fontWeight: '680',
    lineHeight: '1.35',
    display: 'inline',
    color: 'var(--foreground) !important',
    letterSpacing: '-0.015em',
  },
  '.cm-live-h3': {
    fontSize: '1.25em',
    fontWeight: '600',
    lineHeight: '1.4',
    display: 'inline',
    color: 'var(--foreground) !important',
  },
  '.cm-live-h4': {
    fontSize: '1.1em',
    fontWeight: '600',
    display: 'inline',
    color: 'var(--foreground) !important',
  },
  '.cm-live-h5': {
    fontSize: '1.0em',
    fontWeight: '600',
    display: 'inline',
    color: 'var(--foreground) !important',
  },
  '.cm-live-h6': {
    fontSize: '0.9em',
    fontWeight: '600',
    display: 'inline',
    color: 'var(--muted-foreground) !important',
  },
  '.cm-live-h1 *, .cm-live-h2 *, .cm-live-h3 *, .cm-live-h4 *, .cm-live-h5 *, .cm-live-h6 *': {
    fontSize: 'inherit', color: 'inherit', textDecoration: 'none',
  },
  '.cm-live-h1, .cm-live-h2, .cm-live-h3, .cm-live-h4, .cm-live-h5, .cm-live-h6': { textDecoration: 'none' },

  // 光标在标题行时显示的辅助 # 标记（保持大字阶基线，但半透明弱化不抢眼）
  '.cm-live-header-mark': {
    color: 'var(--primary) !important',
    opacity: '0.5 !important',
    fontWeight: '400 !important',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    marginRight: '2px',
  },

  // 光标在行内语法（**、*、~~、`、>）内时浮现的辅助符号
  '.cm-live-syntax-mark': {
    color: 'var(--muted-foreground) !important',
    opacity: '0.45 !important',
    fontWeight: '400 !important',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },

  // 行内样式美化
  '.cm-live-bold': {
    fontWeight: '700',
    color: 'var(--foreground)',
  },
  '.cm-live-italic': {
    fontStyle: 'italic',
  },
  '.cm-live-strike': {
    textDecoration: 'line-through',
    opacity: '0.65',
  },
  '.cm-live-inline-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.88em',
    backgroundColor: 'color-mix(in oklch, var(--muted) 80%, transparent)',
    color: 'var(--foreground)',
    borderRadius: '4px',
    padding: '0.12em 0.38em',
    border: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
  },

  // 超链接所见即所得样式
  '.cm-live-link': {
    color: 'var(--info)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in oklch, var(--info) 55%, transparent)',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
  },
  '.cm-live-link:hover': {
    color: 'var(--info)',
    textDecorationColor: 'var(--info)',
  },

  // 图片 Widget 样式
  '.cm-live-image-wrap': {
    display: 'inline-block',
    margin: '0.5em 0',
    maxWidth: '100%',
    verticalAlign: 'middle',
  },
  '.cm-live-image': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '400px',
    objectFit: 'contain',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    boxShadow: '0 2px 8px -2px rgba(0, 0, 0, 0.08)',
    backgroundColor: 'var(--background)',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  },
  '.cm-live-image:hover': {
    transform: 'scale(1.005)',
    boxShadow: '0 4px 14px -3px rgba(0, 0, 0, 0.15)',
  },
  '.cm-live-image-error': {
    display: 'inline-block',
    padding: '0.3em 0.6em',
    borderRadius: '4px',
    fontSize: '0.85em',
    color: 'var(--muted-foreground)',
    backgroundColor: 'var(--muted)',
    border: '1px dashed var(--border)',
  },

  // 引用块（QuoteMark Widget 竖条装饰）
  '.cm-live-quote-bar': {
    display: 'inline-block',
    width: '3.5px',
    height: '1.1em',
    backgroundColor: 'var(--primary)',
    borderRadius: '2px',
    marginRight: '8px',
    verticalAlign: '-1px',
    opacity: '0.85',
  },

  // 水平分割线
  '.cm-live-hr': {
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '1em 0',
    height: '1px',
    display: 'block',
    width: '100%',
    opacity: '0.7',
  },

  // 任务列表 Checkbox Widget
  '.cm-live-task-checkbox': {
    appearance: 'none',
    width: '14px',
    height: '14px',
    marginRight: '6px',
    verticalAlign: '-2px',
    borderRadius: '3px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--background)',
    cursor: 'pointer',
    position: 'relative',
    display: 'inline-block',
    outline: 'none',
    transition: 'all 0.15s ease',
  },
  '.cm-live-task-checkbox:checked': {
    backgroundColor: 'var(--primary)',
    borderColor: 'var(--primary)',
  },
  '.cm-live-task-checkbox:checked::after': {
    content: '""',
    position: 'absolute',
    left: '4px',
    top: '1px',
    width: '4px',
    height: '8px',
    border: 'solid var(--primary-foreground)',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(45deg)',
  },
  '.cm-live-task-checkbox:hover': {
    borderColor: 'var(--primary)',
  },
}))
