import { toast } from 'sonner'
import { getReaderMarksProvider } from '@/lib/agent/context/reader-marks-registry'
import { getReaderContentProvider } from '@/lib/agent/context/reader-content-registry'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'

export type MarkProposalFailureCode =
  | 'wrong-chapter'
  | 'no-excerpt'
  | 'reader-not-ready'
  | 'unknown'

export interface MarkProposalFailureGuide {
  code: MarkProposalFailureCode
  message: string
  flatIndex?: number
  canOpenChapter: boolean
  canSelectText: boolean
}

/** 从错误文案推断失败引导（不改工具协议也能工作）。 */
export function classifyMarkProposalFailure(
  message: string,
  flatIndex?: number,
): MarkProposalFailureGuide {
  const text = message.trim() || '标记定位失败'
  const navFlat =
    typeof flatIndex === 'number' && Number.isFinite(flatIndex)
      ? flatIndex
      : useReaderNavigationStore.getState().nav.flatIndex

  const lower = text.toLowerCase()
  if (/未就绪|未打开|没有打开/.test(text)) {
    return {
      code: 'reader-not-ready',
      message: text,
      canOpenChapter: false,
      canSelectText: false,
    }
  }
  if (/打开该章|对应章|翻到|当前页|找不到该摘录|未在/.test(text) || /not found/i.test(lower)) {
    return {
      code: /章|chapter|flatindex/i.test(text) ? 'wrong-chapter' : 'no-excerpt',
      message: text,
      flatIndex: navFlat >= 0 ? navFlat : undefined,
      canOpenChapter: navFlat >= 0,
      canSelectText: true,
    }
  }
  if (/划词|选区|selection/.test(text)) {
    return {
      code: 'no-excerpt',
      message: text,
      flatIndex: navFlat >= 0 ? navFlat : undefined,
      canOpenChapter: false,
      canSelectText: true,
    }
  }
  return {
    code: 'unknown',
    message: text,
    flatIndex: navFlat >= 0 ? navFlat : undefined,
    canOpenChapter: navFlat >= 0,
    canSelectText: true,
  }
}

export async function openChapterForMarkRecovery(flatIndex?: number, excerpt?: string): Promise<boolean> {
  const index =
    typeof flatIndex === 'number' && Number.isFinite(flatIndex)
      ? flatIndex
      : useReaderNavigationStore.getState().nav.flatIndex
  if (index < 0) {
    toast.message('当前没有可用章节，请先打开阅读文档')
    return false
  }
  const provider = getReaderMarksProvider()
  if (provider?.navigateToFlatIndex) {
    let navigated = false
    try {
      navigated = await provider.navigateToFlatIndex(index)
    } catch {
      navigated = false
    }
    if (!navigated || getReaderMarksProvider() !== provider) {
      toast.message('未能打开对应章节或文档已切换，请在当前阅读器中重试')
      return false
    }
    toast.message('已打开对应章节，可划选原文后再采用')
    return true
  }
  const content = getReaderContentProvider()
  if (content?.navigateToFlatIndex) {
    try {
      const ok = await content.navigateToFlatIndex(index, excerpt)
      if (ok && getReaderContentProvider() === content) {
        toast.message('已定位原文章节')
        return true
      }
    } catch { /* Navigation failures use the same recovery guide. */ }
    toast.message('未能定位原文或文档已切换，请在当前文档中重试')
    return false
  }
  toast.message('当前文档尚不支持自动章节定位，请手动打开对应章节后再划词')
  return false
}

export function promptSelectTextForMarkRecovery(): void {
  useAcpUiStore.getState().insertComposerSelectionMarker()
  useAcpUiStore.getState().openPanelAndFocusComposer()
  toast.message('请在阅读器中划选原文，再发送或重新采用提议')
}

/** 采用/提议失败时弹出带快捷动作的 toast。 */
export function toastMarkProposalFailure(
  error: unknown,
  options?: { flatIndex?: number },
): MarkProposalFailureGuide {
  const message = error instanceof Error ? error.message : String(error || '操作失败')
  const guide = classifyMarkProposalFailure(message, options?.flatIndex)

  if (guide.canOpenChapter || guide.canSelectText) {
    toast.error(guide.message, {
      duration: 8000,
      action: guide.canOpenChapter
        ? {
            label: '打开该章',
            onClick: () => {
              void openChapterForMarkRecovery(guide.flatIndex)
            },
          }
        : {
            label: '去划词',
            onClick: () => promptSelectTextForMarkRecovery(),
          },
      ...(guide.canOpenChapter && guide.canSelectText
        ? {
            cancel: {
              label: '去划词',
              onClick: () => promptSelectTextForMarkRecovery(),
            },
          }
        : {}),
    })
  } else {
    toast.error(guide.message)
  }

  return guide
}
