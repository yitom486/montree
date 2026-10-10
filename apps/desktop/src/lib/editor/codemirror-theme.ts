import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import type { AppTheme } from '@/stores/editor-ui-store'

const proseHighlight = HighlightStyle.define([], {
  scope: markdownLanguage,
  all: { textDecoration: 'none' },
})

export function buildThemeExtensions(theme: AppTheme, fontSize: number, livePreview = false) {
  const isDark = theme === 'dark'
  const codeHighlight = isDark ? oneDarkHighlightStyle : defaultHighlightStyle

  return [
    livePreview ? [
      // Prose decorations supply semantic styles. Keep code highlighting in nested languages.
      syntaxHighlighting(proseHighlight),
      syntaxHighlighting({ style: codeHighlight.style, scope: (node) => !proseHighlight.scope?.(node) }),
      EditorView.styleModule.of(codeHighlight.module!),
    ] : syntaxHighlighting(codeHighlight, { fallback: true }),
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: `${fontSize}px`,
        backgroundColor: 'var(--editor)',
        color: 'var(--foreground)',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        lineHeight: '1.65',
      },
      '.cm-content': {
        padding: '20px 0',
        caretColor: 'var(--primary)',
      },
      '.cm-line': {
        padding: '0 20px',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: isDark ? '#7aa2f7' : 'var(--primary)',
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        {
          backgroundColor: 'color-mix(in oklch, var(--primary) 35%, transparent)',
        },
      '.cm-gutters': {
        backgroundColor: 'var(--editor)',
        color: isDark ? '#6b7280' : 'var(--muted-foreground)',
        borderRight: '1px solid var(--border)',
        paddingRight: '4px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'color-mix(in oklch, var(--accent) 40%, transparent)',
        color: isDark ? '#d4d4d4' : 'var(--foreground)',
      },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in oklch, var(--accent) 25%, transparent)',
      },
      '.cm-foldGutter span': {
        color: isDark ? '#6b7280' : 'var(--muted-foreground)',
        cursor: 'pointer',
      },
      '.cm-placeholder': {
        color: isDark ? '#6b7280' : 'var(--muted-foreground)',
        fontStyle: 'italic',
      },
      '.cm-lintRange-error': {
        backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='m0 3 l2 -2 l1 0 l2 2 l1 0' fill='%23ef4444' /></svg>")`,
        backgroundRepeat: 'repeat-x',
        backgroundPosition: 'left bottom',
      },
      '.cm-lintRange-warning': {
        backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='6' height='3'><path d='m0 3 l2 -2 l1 0 l2 2 l1 0' fill='%23f59e0b' /></svg>")`,
        backgroundRepeat: 'repeat-x',
        backgroundPosition: 'left bottom',
      },
      '.cm-gutter-lint': {
        width: '1em',
      },
      '.cm-gutter-lint .cm-lintMarker-error': {
        content: '"●"',
        color: '#ef4444',
      },
      '.cm-gutter-lint .cm-lintMarker-warning': {
        content: '"●"',
        color: '#f59e0b',
      },

      /* 自动补全浮层（如 [[ 双链）全套现代化 UI 样式 */
      '.cm-tooltip.cm-tooltip-autocomplete': {
        border: '1px solid var(--border)',
        backgroundColor: isDark ? 'rgba(24, 24, 27, 0.96)' : 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(16px)',
        borderRadius: '10px',
        boxShadow: isDark
          ? '0 20px 40px -8px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)'
          : '0 12px 32px -4px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        padding: '6px',
        minWidth: '320px',
        maxWidth: '560px',
        overflow: 'hidden',
        zIndex: '100',
      },
      '.cm-tooltip-autocomplete > ul': {
        maxHeight: '280px',
        padding: '2px',
        margin: '0',
        listStyle: 'none',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      '.cm-tooltip-autocomplete > ul > li': {
        display: 'flex',
        alignItems: 'center',
        padding: '7px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: isDark ? '#e4e4e7' : 'var(--foreground)',
        transition: 'background-color 0.12s ease, color 0.12s ease',
        lineHeight: '1.4',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: isDark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(59, 130, 246, 0.12)',
        color: isDark ? '#60a5fa' : '#2563eb',
        fontWeight: '500',
      },
      '.cm-completionIcon': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        marginRight: '8px',
        flexShrink: '0',
      },
      '.cm-completionIcon-book:after': {
        content: '""',
        display: 'block',
        width: '16px',
        height: '16px',
        backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z'/><path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'/></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      },
      '.cm-completionIcon-note:after': {
        content: '""',
        display: 'block',
        width: '16px',
        height: '16px',
        backgroundImage: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/></svg>")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      },
      '.cm-completionLabel': {
        fontSize: '13px',
        fontWeight: '500',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: '1 1 auto',
      },
      '.cm-completionDetail': {
        fontSize: '11px',
        color: isDark ? '#71717a' : 'var(--muted-foreground)',
        marginLeft: '12px',
        fontStyle: 'normal',
        opacity: '0.8',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '180px',
        flexShrink: '0',
      },
      '.cm-completionMatchedText': {
        color: isDark ? '#93c5fd' : '#1d4ed8',
        fontWeight: '600',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
      },
    }),
  ]
}
