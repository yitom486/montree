import { setProposalExtensionFactory, setProposalReviewModeSource } from '../text-document'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { onThreadLifecycle } from '@/lib/agent/thread-lifecycle'
import { proposalExtension } from './proposal-extension'
import { withdrawProposals } from './live-documents'
import { selectionActionsExtension } from './selection-actions-extension'
import { buildSelectionEditPrompt } from './selection-prompt'
import { requestAgentPrompt, setAgentPanelOpener } from '@/lib/agent/agent-prompt-bus'
import { toast } from 'sonner'
import type { TextDocument } from '../text-document'
import { inlineCompletion } from '../inline-completion/inline-completion-extension'
import { fetchInlineCompletions, inlineCompletionConfigured, refreshInlineCompletionStatus } from '../inline-completion/inline-completion-client'

export function inlineCompletionEnabledFor(filePath: string): boolean {
  const settings = useAppSettingsStore.getState()
  return settings.aiInlineCompletion && !settings.inlineCompletionDisabledFiles.includes(filePath) && inlineCompletionConfigured()
}

function requestSelectionEdit(document: TextDocument, action: Parameters<typeof buildSelectionEditPrompt>[1], instruction?: string): void {
  const selection = document.selectionSnapshot()
  if (!selection) { toast.info('请先选中要修改的文本'); return }
  try { requestAgentPrompt(buildSelectionEditPrompt(selection, action, instruction)) }
  catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
}

/** 渲染进程启动时注册：编辑器状态自动携带建议可视化；审阅模式读取应用设置。 */
setProposalExtensionFactory((document) => [
  proposalExtension(document.proposals),
  selectionActionsExtension((action, instruction) => requestSelectionEdit(document, action, instruction)),
  inlineCompletion({
    language: /\.typ$/i.test(document.filePath) ? 'typst' : 'markdown',
    enabled: () => inlineCompletionEnabledFor(document.filePath),
    fetch: (context, signal) => fetchInlineCompletions(document.filePath, context, signal),
  }),
])
setAgentPanelOpener(() => useAcpUiStore.getState().setPanelOpen(true))
setProposalReviewModeSource(() => useAppSettingsStore.getState().aiEditReviewMode)

const NOTES = { cancel: '对话已取消', clear: '对话已清空', delete: '对话已删除' } as const
onThreadLifecycle(({ kind, threadId }) => { withdrawProposals((item) => item.threadId === threadId, NOTES[kind]) })

// Agent 断开：撤回所有来自 Agent 线程的未处理建议（不提交任何修改）
let previousStatus = useAcpUiStore.getState().status
useAcpUiStore.subscribe((state) => {
  const status = state.status
  if (status === previousStatus) return
  const wasLive = previousStatus === 'connected'
  previousStatus = status
  if (wasLive && (status === 'disconnected' || status === 'error')) withdrawProposals((item) => item.threadId !== null, 'Agent 已断开')
})
void refreshInlineCompletionStatus()
