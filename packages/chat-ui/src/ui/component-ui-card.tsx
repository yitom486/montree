// 自 `apps/desktop/src/components/agent/generative/ComponentUiCard.tsx` 整搬（M3d present 批，pure）：
// `ArtifactZoomSurface` 改同包相对 `./artifact-zoom-surface`，`cn` 改 `./cn`，
// `Button` 改包内 `./button`，`result-card` 改 `./result-card`；contracts/`@assistant-ui/react` 保留；余逐字。
import { createContext, useContext, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Component } from 'react'
import { ArtifactZoomSurface } from './artifact-zoom-surface'
import { ArrowRight, Send } from 'lucide-react'
import { GenerativeUIRender } from '@assistant-ui/react'
import { cn } from './cn'
import { Button } from './button'
import {
  RESULT_CARD_HEADER,
  RESULT_CARD_ICON,
  RESULT_CARD_SUMMARY,
  resultCardClassName,
} from './result-card'
import type { PresentComponentUi } from '@montree/contracts'
import { COMPONENT_UI_MAX_SUBMIT_BYTES } from '@montree/contracts'

export interface GenerativeSubmitPayload {
  resultId: string
  threadId: string
  title: string
  selections: Record<string, string | string[]>
  displayText: string
  promptText: string
}

interface ComponentUiCardProps {
  result: PresentComponentUi
  threadId: string
  prompting?: boolean
  onSubmit?: (payload: GenerativeSubmitPayload) => void | Promise<void>
  onLocateChapter?: (flatIndex: number, excerpt?: string) => void
  className?: string
}

type SelectionState = Record<string, string | string[]>

const InteractionContext = createContext<{
  result: PresentComponentUi
  selections: SelectionState
  disabled: boolean
  canSubmit: boolean
  submit: () => void
  setSingle: (id: string, value: string) => void
  toggleMulti: (id: string, value: string) => void
  locate?: (flatIndex: number, excerpt?: string) => void
}>(null!)

function collectSelectDefaults(root: unknown): SelectionState {
  const state: SelectionState = {}
  const visit = (node: unknown): void => {
    if (typeof node === 'string' || typeof node === 'number' || node == null) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node !== 'object') return
    const { component, props, children } = node as {
      component?: unknown
      props?: Record<string, unknown>
      children?: unknown
    }
    if (component === 'Select' && props && typeof props.id === 'string') {
      const multi = props.multi === true
      const def = props.defaultValue
      if (multi) {
        state[props.id] = Array.isArray(def) ? def.map(String) : []
      } else {
        state[props.id] = typeof def === 'string' ? def : ''
      }
    }
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children]
      for (const child of list) visit(child)
    }
  }
  visit(root)
  return state
}

function collectSelectOptions(root: unknown): Map<string, { label: string; multi: boolean }> {
  const map = new Map<string, { label: string; multi: boolean }>()
  const visit = (node: unknown): void => {
    if (typeof node === 'string' || typeof node === 'number' || node == null) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node !== 'object') return
    const { component, props, children } = node as {
      component?: unknown
      props?: Record<string, unknown>
      children?: unknown
    }
    if (component === 'Select' && props && typeof props.id === 'string') {
      map.set(props.id, {
        label: typeof props.label === 'string' ? props.label : props.id,
        multi: props.multi === true,
      })
    }
    if (children !== undefined) {
      const list = Array.isArray(children) ? children : [children]
      for (const child of list) visit(child)
    }
  }
  visit(root)
  return map
}

/** 纯函数：选择 → 可读展示文案 + 发给 Agent 的后续输入 */
export function buildGenerativeSubmitTexts(
  result: Pick<PresentComponentUi, 'id' | 'title'>,
  selections: SelectionState,
  optionLabels?: Map<string, { label: string; multi: boolean }>,
): { displayText: string; promptText: string } {
  const lines = Object.entries(selections).map(([id, value]) => {
    const label = optionLabels?.get(id)?.label ?? id
    const text = Array.isArray(value) ? value.join('、') : value
    return `${label}=${text || '（未选）'}`
  })
  const displayText = `已选择（来自「${result.title}」）：${lines.join('；')}`
  const promptText = [
    `[generative-ui-submit resultId=${result.id}]`,
    `界面「${result.title}」的用户选择：`,
    ...Object.entries(selections).map(([id, value]) => {
      const text = Array.isArray(value) ? value.join(', ') : value
      return `- ${id}: ${text}`
    }),
    '请基于以上选择继续分析（同一会话的后续回合）。',
  ].join('\n')
  return { displayText, promptText }
}

function UnknownComponentFallback({ component }: { component: string; props?: unknown }) {
  return (
    <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
      未知组件 {component}（已跳过，不影响其余内容）
    </p>
  )
}

class ComponentUiErrorBoundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : '渲染失败' }
  }
  componentDidCatch() {}
  render() {
    if (this.state.failed) {
      return (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-muted-foreground">
          该界面渲染失败（{this.state.failed.slice(0, 120)}），可换种问法重试。
        </p>
      )
    }
    return this.props.children
  }
}

/**
 * 生成式 UI 卡（G2）：官方 GenerativeUIRender + 白名单注册表。
 * 选择态为组件本地 state（父级按 result.id 给 key，chunk 更新不重置）；
 * 提交/定位只经宿主回调，不直发模型、不碰 IPC、不执行任意代码。
 */
export function ComponentUiCard({ result, threadId, prompting, onSubmit, onLocateChapter, className }: ComponentUiCardProps) {
  const [selections, setSelections] = useState<SelectionState>(() => collectSelectDefaults(result.ui.root))
  const optionLabels = useMemo(() => collectSelectOptions(result.ui.root), [result.ui])
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const setSingle = (id: string, value: string) =>
    setSelections((prev) => ({ ...prev, [id]: value }))
  const toggleMulti = (id: string, value: string) =>
    setSelections((prev) => {
      const cur = prev[id]
      const list = Array.isArray(cur) ? cur : []
      return { ...prev, [id]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] }
    })

  const handleSubmit = async () => {
    if (prompting || submittingRef.current || !onSubmit) return
    if (new TextEncoder().encode(JSON.stringify(selections)).length > COMPONENT_UI_MAX_SUBMIT_BYTES) {
      setSubmitError('选择内容超过 8KiB，请减少选项后重试')
      return
    }
    setSubmitError(null)
    submittingRef.current = true
    setSubmitting(true)
    const { displayText, promptText } = buildGenerativeSubmitTexts(result, selections, optionLabels)
    try {
      await onSubmit({ resultId: result.id, threadId, title: result.title, selections, displayText, promptText })
    } catch {
      setSubmitError('提交失败，请重试')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const components = useMemo(() => {
    const Card: ComponentType<{ title?: string; description?: string; children?: ReactNode }> = ({ title, description, children }) => (
      <div className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
        {title ? <p className="text-xs font-semibold text-foreground">{title}</p> : null}
        {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
        <div className={cn(title || description ? 'mt-1.5' : '', 'min-w-0 space-y-1.5')}>{children}</div>
      </div>
    )
    const Row: ComponentType<{ gap?: string; children?: ReactNode }> = ({ gap, children }) => (
      <div className={cn('flex min-w-0 flex-row flex-wrap', gap === 'sm' ? 'gap-1' : gap === 'lg' ? 'gap-3' : 'gap-2')}>{children}</div>
    )
    const Column: ComponentType<{ gap?: string; children?: ReactNode }> = ({ gap, children }) => (
      <div className={cn('flex min-w-0 flex-col', gap === 'sm' ? 'gap-1' : gap === 'lg' ? 'gap-3' : 'gap-2')}>{children}</div>
    )
    const Text: ComponentType<{ text: string; variant?: string }> = ({ text, variant }) => (
      <p
        className={cn(
          'break-words [overflow-wrap:anywhere]',
          variant === 'title' ? 'text-xs font-semibold text-foreground' : null,
          variant === 'caption' ? 'text-[10px] text-muted-foreground' : null,
          variant === 'muted' ? 'text-[11px] text-muted-foreground' : null,
          !variant || variant === 'body' ? 'text-[11px] leading-relaxed text-foreground/90' : null,
        )}
      >
        {text}
      </p>
    )
    const Select: ComponentType<{ id: string; label?: string; options: Array<{ value: string; label: string; description?: string }>; multi?: boolean }> = ({ id, label, options, multi }) => {
      const { selections, toggleMulti, setSingle } = useContext(InteractionContext)
      const cur = selections[id]
      const isActive = (v: string) => (multi ? (Array.isArray(cur) ? cur.includes(v) : false) : cur === v)
      return (
        <div className="min-w-0" role={multi ? 'group' : 'radiogroup'} aria-label={label ?? id}>
          {label ? <p className="mb-1 text-[11px] font-medium text-foreground/90">{label}</p> : null}
          <div className="flex flex-wrap gap-1">
            {(options ?? []).map((opt, index) => {
              const active = isActive(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  role={multi ? undefined : 'radio'}
                  aria-checked={multi ? undefined : active}
                  aria-pressed={multi ? active : undefined}
                  tabIndex={multi || active || (!cur && index === 0) ? 0 : -1}
                  onKeyDown={event => {
                    if (multi || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                    event.preventDefault()
                    const next = (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                    setSingle(id, options[next]!.value)
                    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                    buttons?.[next]?.focus()
                  }}
                  title={opt.description ?? opt.label}
                  onClick={() => (multi ? toggleMulti(id, opt.value) : setSingle(id, opt.value))}
                  className={cn(
                    'inline-flex min-h-8 max-w-full items-center truncate rounded-full border px-2.5 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring',
                    active
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border/60 bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )
    }
    const GxButton: ComponentType<{ label: string; action: string; variant?: string; chapterKey?: string; excerpt?: string }> = ({ label, action, variant, chapterKey, excerpt }) => {
      const { result, locate: onLocateChapter, disabled, canSubmit, submit } = useContext(InteractionContext)
      if (action === 'locate') {
        const flatIndex = result.chapters.find(chapter => chapter.key === chapterKey)?.flatIndex
        if (typeof flatIndex !== 'number') {
          return <span className="text-[10px] text-muted-foreground/70">无定位</span>
        }
        return (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-primary"
            onClick={() => onLocateChapter?.(flatIndex, excerpt)}
          >
            {label}
            <ArrowRight className="size-2.5" />
          </Button>
        )
      }
      return (
        <Button
          type="button"
          size="sm"
          variant={variant === 'secondary' ? 'secondary' : variant === 'outline' ? 'outline' : 'default'}
          className="min-h-11 px-3 text-xs"
          disabled={disabled || !canSubmit}
          title={disabled ? '上一轮还没结束，请稍候' : label}
          onClick={submit}
        >
          <Send className="size-3.5" />
          {label}
        </Button>
      )
    }
    const Evidence: ComponentType<{ excerpt: string; chapterKey: string; chapterLabel?: string }> = ({ excerpt, chapterKey, chapterLabel }) => {
      const { result, locate: onLocateChapter } = useContext(InteractionContext)
      const chapter = result.chapters.find((c) => c.key === chapterKey)
      const flatIndex = chapter?.flatIndex
      const locatable = typeof flatIndex === 'number'
      return (
        <div className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5">
          <p className="text-[10px] font-medium text-muted-foreground">
            {chapterLabel ?? chapter?.label ?? chapterKey}
            {!locatable ? ' · 无定位' : ''}
          </p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
            {excerpt}
          </p>
          {locatable ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 h-6 px-1.5 text-[10px] text-primary"
              onClick={() => onLocateChapter?.(flatIndex, excerpt)}
            >
              定位原文
              <ArrowRight className="size-2.5" />
            </Button>
          ) : null}
        </div>
      )
    }
    return { Card, Row, Column, Text, Select, Button: GxButton, Evidence }
  }, [])

  return (
    <div
      className={cn('@container', resultCardClassName(className))}
      data-testid="component-ui-card"
      data-present-id={result.id}
    >
      <div className={RESULT_CARD_HEADER}>
        <div className="flex min-w-0 items-center gap-2">
          <div className={RESULT_CARD_ICON}>
            <Send className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-xs font-semibold tracking-tight text-foreground">{result.title}</h4>
            <p className={RESULT_CARD_SUMMARY}>
              交互界面 · {result.chapters.length} 章{result.summary ? ` · ${result.summary}` : ''}
            </p>
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-2 p-2">
        <ArtifactZoomSurface title={result.title}>
        {submitError ? <p role="alert" className="text-xs text-destructive">{submitError}</p> : null}
        <ComponentUiErrorBoundary>
          <InteractionContext.Provider value={{ result, selections, disabled: Boolean(prompting) || submitting, canSubmit: Boolean(onSubmit), submit: () => { void handleSubmit() }, setSingle, toggleMulti, locate: onLocateChapter }}>
          <GenerativeUIRender
            spec={result.ui as unknown as Parameters<typeof GenerativeUIRender>[0]['spec']}
            components={components as unknown as Parameters<typeof GenerativeUIRender>[0]['components']}
            Fallback={UnknownComponentFallback as unknown as Parameters<typeof GenerativeUIRender>[0]['Fallback']}
          />
          </InteractionContext.Provider>
        </ComponentUiErrorBoundary>
        </ArtifactZoomSurface>
      </div>
    </div>
  )
}
