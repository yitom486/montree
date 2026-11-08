import { MessageSquare, PanelsTopLeft, X } from 'lucide-react'
import { AgentPanel } from '@/components/agent/AgentPanel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useReaderHudUiStore } from '@/stores/acp/reader-hud-store'
import { preserveScrollAnchor } from '@/lib/reader/scroll-anchor'

interface WorkspaceCompanionPanelProps {
  workspaceRoot?: string
  readerAvailable: boolean
  showCards: boolean
  onCardsHost: (host: HTMLDivElement | null) => void
}

export function WorkspaceCompanionPanel({
  workspaceRoot,
  readerAvailable,
  showCards,
  onCardsHost,
}: WorkspaceCompanionPanelProps) {
  const selectTab = (value: string) => preserveScrollAnchor(() => {
    if (value === 'cards') {
      useReaderHudUiStore.getState().setIsCardRailOpen(true)
    } else {
      useAcpUiStore.getState().setHudDisplayMode('docked')
      useAcpUiStore.getState().openPanelAndFocusComposer()
    }
  })

  return (
    <Tabs
      value={showCards ? 'cards' : 'chat'}
      onValueChange={selectTab}
      className="flex h-full min-w-0 flex-col gap-0 bg-background"
      data-testid="workspace-companion-panel"
    >
      <div className="flex h-[42px] shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <TabsList className="h-8 bg-transparent p-0" aria-label="工作区辅助面板">
          <TabsTrigger value="chat" className="gap-1.5 px-2 text-xs">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            AI 对话
          </TabsTrigger>
          {readerAvailable && (
            <TabsTrigger value="cards" className="gap-1.5 px-2 text-xs">
              <PanelsTopLeft className="size-3.5" aria-hidden="true" />
              卡片流
            </TabsTrigger>
          )}
        </TabsList>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label="收起辅助面板"
          title="收起辅助面板"
          onClick={() => preserveScrollAnchor(() => {
            useReaderHudUiStore.getState().setIsCardRailOpen(false)
            useAcpUiStore.getState().setPanelOpen(false)
          })}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {/* forceMount 保留聊天输入、会话与卡片筛选，隐藏页退出键盘焦点顺序。 */}
      <TabsContent value="chat" forceMount className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <div className="h-full w-full" style={{ contain: 'strict' }} data-testid="workspace-agent-frame">
          <AgentPanel workspaceRoot={workspaceRoot} embedded />
        </div>
      </TabsContent>
      <TabsContent value="cards" forceMount className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <div ref={onCardsHost} className="h-full min-w-0" data-testid="workspace-cards-host" />
      </TabsContent>
    </Tabs>
  )
}
