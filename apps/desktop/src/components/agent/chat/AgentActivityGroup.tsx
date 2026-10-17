import { ChatActivityGroup, type ChatWorkLogItem, type ChapterMarkPlanSelectPayload } from '@yitom/chat-ui'
import { dismissProposedMark } from '@/lib/agent/context/propose-mark'
import { respondPermissionRequest } from '@/lib/agent/permission-respond'
import { openChapterForMarkRecovery, promptSelectTextForMarkRecovery } from '@/lib/agent/mark-proposal-failure'
import { useAcpPendingPermission, useAcpUiStore } from '@/stores/acp-ui-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { ToolBusinessResult } from '@/components/agent/tools/ToolBusinessResult'
import { AgentPlanCard } from '@/components/agent/tools/AgentPlanCard'

export type WorkLogItem = ChatWorkLogItem

interface AgentActivityGroupProps {
  group: WorkLogItem
  running?: boolean
  onChapterPlanSelect?: (payload: ChapterMarkPlanSelectPayload) => void
  onEditMessage?: (text: string) => void
}

/** 工作记录宿主适配：读取应用状态、接业务回调；折叠/摘要/工具行由共享组件负责。 */
export function AgentActivityGroup(props: AgentActivityGroupProps) {
  const resolveMarkProposal = useAcpUiStore((s) => s.resolveMarkProposal)
  const pendingPermission = useAcpPendingPermission()
  const navFlatIndex = useReaderNavigationStore((s) => s.nav.flatIndex)
  const theme = useEditorUiStore((s) => s.theme)
  return (
    <ChatActivityGroup
      {...props}
      resolveMarkProposal={resolveMarkProposal}
      pendingPermission={pendingPermission}
      navFlatIndex={navFlatIndex}
      theme={theme}
      onDismissProposedMark={dismissProposedMark}
      onPermissionRespond={(optionId) => {
        if (pendingPermission) respondPermissionRequest(pendingPermission, optionId)
      }}
      onRecoverChapter={(flatIndex) => { void openChapterForMarkRecovery(flatIndex) }}
      onPromptSelectText={() => promptSelectTextForMarkRecovery()}
      renderBusinessResult={(message, opts) => <ToolBusinessResult message={message} {...opts} />}
      renderPlanCard={(message) => <AgentPlanCard message={message} />}
    />
  )
}
