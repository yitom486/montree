import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { refreshInlineCompletionStatus } from '@/lib/editor/inline-completion/inline-completion-client'
import { cn } from '@/lib/utils'

/** 状态栏：当前文件的 AI 行内补全开关（全局关闭或未配置模型时给出说明）。 */
export function InlineCompletionToggle({ filePath }: { filePath: string }) {
  const globalOn = useAppSettingsStore((state) => state.aiInlineCompletion)
  const disabled = useAppSettingsStore((state) => state.inlineCompletionDisabledFiles.includes(filePath))
  const toggle = useAppSettingsStore((state) => state.toggleInlineCompletionForFile)
  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => { let alive = true; void refreshInlineCompletionStatus().then((s) => { if (alive) setConfigured(s.configured) }); return () => { alive = false } }, [filePath])
  const active = globalOn && !disabled && configured === true
  const title = configured === false ? 'AI 补全：未配置模型（在 Agent 面板“自定义模型供应商”中设置）'
    : !globalOn ? 'AI 补全：已在设置中关闭' : disabled ? 'AI 补全：此文件已关闭，点击开启' : 'AI 补全：已开启，点击为此文件关闭'
  return (
    <button type="button" className={cn('flex items-center gap-1 hover:text-foreground', !active && 'opacity-60')} title={title} aria-label={title}
      aria-pressed={active} disabled={configured === false || !globalOn} onClick={() => toggle(filePath)} data-testid="inline-completion-toggle">
      <Sparkles className="size-3" /><span>{active ? '补全' : '补全关'}</span>
    </button>
  )
}
