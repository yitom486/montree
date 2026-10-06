import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { DiagramPayload } from '@/components/agent/tools/DiagramViewerCard'
import type { AcpHudDisplayMode } from './acp-types'

export type { AcpHudDisplayMode }
export type HudActiveTab = 'chat' | 'cards' | 'summary' | 'outline'

export interface ReaderHudUiState {
  /** 伴读 HUD 显示模态：docked（侧栏停靠）、floating（悬浮微晶小窗）、capsule（右下角极简胶囊） */
  hudDisplayMode: AcpHudDisplayMode
  /** 面板是否处于开启状态（docked 展开或 floating 呈现） */
  panelOpen: boolean
  /** 悬浮窗自由拖拽绝对坐标 */
  floatingPosition: { x: number; y: number }
  /** 悬浮窗自由拉伸尺寸（右下角手柄拖拽） */
  floatingSize: { width: number; height: number }
  /** 阅读器内停靠态 Agent 面板宽度（左侧分隔线拖拽，280~640） */
  dockedAgentWidth: number
  /** 是否正在拖拽悬浮窗 */
  isDragging: boolean
  /** HUD 内部当前活跃的功能 Tab */
  hudActiveTab: HudActiveTab
  /** 右侧 Marginalia 知识卡轨是否展开 */
  isCardRailOpen: boolean
  /** 全书札记中心抽屉是否开启 */
  isNotesDrawerOpen: boolean
  /** 书库与在线文档抽屉是否开启 */
  isLibraryOpen: boolean
  /** 当前全屏放大检视的图表数据 */
  selectedDiagram: DiagramPayload | null
  /** 免打扰自动授权安全模式（低危只读工具免弹窗） */
  approveForMe: boolean
  /** 历史会话抽屉/下拉是否开启 */
  historyOpen: boolean
  /** 沉浸禅模式（隐藏多栏与边框，居中聚焦正文） */
  zenMode: boolean
  /** 递增以触发 AgentComposer 聚焦 */
  composerFocusNonce: number
  /** 递增以在输入框追加「选区」短标记 */
  composerInsertNonce: number

  // Actions
  setHudDisplayMode: (mode: AcpHudDisplayMode) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setFloatingPosition: (pos: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void
  setFloatingSize: (size: { width: number; height: number }) => void
  setDockedAgentWidth: (width: number) => void
  setIsDragging: (dragging: boolean) => void
  setHudActiveTab: (tab: HudActiveTab) => void
  setIsCardRailOpen: (open: boolean) => void
  toggleCardRail: (open?: boolean) => void
  setIsNotesDrawerOpen: (open: boolean) => void
  setIsLibraryOpen: (open: boolean) => void
  setSelectedDiagram: (diagram: DiagramPayload | null) => void
  setApproveForMe: (approve: boolean) => void
  toggleApproveForMe: () => void
  setHistoryOpen: (open: boolean) => void
  setZenMode: (zen: boolean) => void
  toggleZenMode: () => void
  requestComposerFocus: () => void
  openPanelAndFocusComposer: () => void
  insertComposerSelectionMarker: () => void
}

const getDefaultFloatingPosition = () => {
  if (typeof window !== 'undefined') {
    return {
      x: Math.max(20, window.innerWidth - 470),
      y: Math.max(48, window.innerHeight - 620),
    }
  }
  return { x: 800, y: 56 }
}

export const useReaderHudUiStore = create<ReaderHudUiState>()(
  persist(
    (set, get) => ({
      hudDisplayMode: 'floating',
      panelOpen: false,
      floatingPosition: getDefaultFloatingPosition(),
      floatingSize: { width: 450, height: 580 },
      dockedAgentWidth: 340,
      isDragging: false,
      hudActiveTab: 'chat',
      isCardRailOpen: true,
      isNotesDrawerOpen: false,
      isLibraryOpen: false,
      selectedDiagram: null,
      approveForMe: false,
      historyOpen: false,
      zenMode: false,
      composerFocusNonce: 0,
      composerInsertNonce: 0,

      setHudDisplayMode: (mode) => set({ hudDisplayMode: mode }),
      setPanelOpen: (open) => set({ panelOpen: open }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setFloatingPosition: (pos) =>
        set((s) => ({
          floatingPosition: typeof pos === 'function' ? pos(s.floatingPosition) : pos,
        })),
      setFloatingSize: (size) =>
        set({
          floatingSize: {
            width: Math.round(size.width),
            height: Math.round(size.height),
          },
        }),
      setDockedAgentWidth: (width) =>
        set({ dockedAgentWidth: Math.round(Math.max(280, Math.min(640, width))) }),
      setIsDragging: (dragging) => set({ isDragging: dragging }),
      setHudActiveTab: (tab) => set({ hudActiveTab: tab }),
      setIsCardRailOpen: (open) => set({ isCardRailOpen: open }),
      toggleCardRail: (open) =>
        set((s) => ({
          isCardRailOpen: open !== undefined ? open : !s.isCardRailOpen,
        })),
      setIsNotesDrawerOpen: (open) => set({ isNotesDrawerOpen: open }),
      setIsLibraryOpen: (open) => set({ isLibraryOpen: open }),
      setSelectedDiagram: (diagram) => set({ selectedDiagram: diagram }),
      setApproveForMe: (approve) => set({ approveForMe: approve }),
      toggleApproveForMe: () => set((s) => ({ approveForMe: !s.approveForMe })),
      setHistoryOpen: (open) => set({ historyOpen: open }),
      setZenMode: (zen) => set({ zenMode: zen }),
      toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode })),

      requestComposerFocus: () => {
        if (!get().panelOpen) return
        set((s) => ({ composerFocusNonce: s.composerFocusNonce + 1 }))
      },
      openPanelAndFocusComposer: () =>
        set((s) => ({
          panelOpen: true,
          hudDisplayMode: s.hudDisplayMode === 'capsule' ? 'floating' : s.hudDisplayMode,
          composerFocusNonce: s.composerFocusNonce + 1,
        })),
      insertComposerSelectionMarker: () =>
        set((s) => ({
          panelOpen: true,
          hudDisplayMode: s.hudDisplayMode === 'capsule' ? 'floating' : s.hudDisplayMode,
          composerFocusNonce: s.composerFocusNonce + 1,
          composerInsertNonce: s.composerInsertNonce + 1,
        })),
    }),
    {
      name: 'montree-reader-hud-ui',
      partialize: (state) => ({
        hudDisplayMode: state.hudDisplayMode,
        isCardRailOpen: state.isCardRailOpen,
        approveForMe: state.approveForMe,
        floatingPosition: state.floatingPosition,
        floatingSize: state.floatingSize,
        dockedAgentWidth: state.dockedAgentWidth,
      }),
    },
  ),
)

export function useReaderHudUi<T>(selector: (state: ReaderHudUiState) => T): T {
  return useReaderHudUiStore(useShallow(selector))
}
