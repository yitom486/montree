import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { scopeDocumentKey } from '@montree/contracts'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { applyThemeWithViewTransition } from '@/lib/editor/theme-transition'

/** 编辑区布局：仅源码 / 仅预览 / 左右分栏 */
export type EditorViewMode = 'editor' | 'preview' | 'split'

/** 应用外观；支持纸张白、石墨极夜、羊皮纸暖调三态 */
export type AppTheme = 'light' | 'dark' | 'sepia'

export interface FileUiState {
  viewMode: EditorViewMode
  editorScrollRatio: number
  previewScrollRatio: number
}

const DEFAULT_FILE_STATE: FileUiState = {
  viewMode: 'editor',
  editorScrollRatio: 0,
  previewScrollRatio: 0,
}

const UNTITLED_KEY = '__untitled__'

/**
 * 文件 UI 状态键：local/缺省沿用裸路径（回归零变化），远端按
 * workspaceId 命名空间隔离（同一相对路径在不同工作区是不同文档）。
 */
function resolveFileKey(filePath?: string, workspaceId?: string): string {
  return scopeDocumentKey(filePath ?? UNTITLED_KEY, workspaceId)
}

interface EditorUiStore {
  theme: AppTheme
  outlineExpanded: boolean
  webDocExpanded: boolean
  fileTreeExpanded: boolean
  sidebarVisible: boolean
  directoryReveal: { path: string; version: number } | null
  revealDirectory: (path: string) => void
  fileStates: Record<string, FileUiState>
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
  cycleTheme: () => void
  setOutlineExpanded: (expanded: boolean) => void
  setWebDocExpanded: (expanded: boolean) => void
  setFileTreeExpanded: (expanded: boolean) => void
  setSidebarVisible: (visible: boolean) => void
  toggleSidebar: () => void
  getFileState: (filePath?: string, workspaceId?: string) => FileUiState
  setViewMode: (filePath: string | undefined, mode: EditorViewMode, workspaceId?: string) => void
  saveScrollState: (
    filePath: string | undefined,
    editorScrollRatio: number,
    previewScrollRatio: number,
    workspaceId?: string,
  ) => void
}

export const useEditorUiStore = create<EditorUiStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      outlineExpanded: false,
      webDocExpanded: true,
      fileTreeExpanded: true,
      sidebarVisible: true,
      directoryReveal: null,
      revealDirectory: (path) => set((state) => ({ directoryReveal: { path, version: (state.directoryReveal?.version ?? 0) + 1 }, sidebarVisible: true, fileTreeExpanded: true })),
      fileStates: {},

      setTheme: (theme) => {
        applyThemeWithViewTransition(theme, () => {
          set({ theme })
        })
      },
      toggleTheme: () => {
        const current = get().theme
        const next: AppTheme =
          current === 'light' ? 'sepia' : current === 'sepia' ? 'dark' : 'light'
        applyThemeWithViewTransition(next, () => {
          set({ theme: next })
        })
      },
      cycleTheme: () => {
        const current = get().theme
        const next: AppTheme =
          current === 'light' ? 'sepia' : current === 'sepia' ? 'dark' : 'light'
        applyThemeWithViewTransition(next, () => {
          set({ theme: next })
        })
      },

      setOutlineExpanded: (expanded) => set({ outlineExpanded: expanded }),
      setWebDocExpanded: (expanded) => set({ webDocExpanded: expanded }),
      setFileTreeExpanded: (expanded) => set({ fileTreeExpanded: expanded }),

      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),

      toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),

      getFileState: (filePath, workspaceId) => {
        const key = resolveFileKey(filePath, workspaceId)
        const stored = get().fileStates[key]
        if (stored) return stored
        const defaultViewMode = useAppSettingsStore.getState().defaultViewMode
        return { ...DEFAULT_FILE_STATE, viewMode: defaultViewMode }
      },

      setViewMode: (filePath, mode, workspaceId) => {
        const key = resolveFileKey(filePath, workspaceId)
        const prev = get().fileStates[key]
        if (prev?.viewMode === mode) return

        set((state) => ({
          fileStates: {
            ...state.fileStates,
            [key]: {
              ...(state.fileStates[key] ?? DEFAULT_FILE_STATE),
              viewMode: mode,
            },
          },
        }))
      },

      saveScrollState: (filePath, editorScrollRatio, previewScrollRatio, workspaceId) => {
        const key = resolveFileKey(filePath, workspaceId)
        const prev = get().fileStates[key]
        if (
          prev &&
          prev.editorScrollRatio === editorScrollRatio &&
          prev.previewScrollRatio === previewScrollRatio
        ) {
          return
        }

        set((state) => ({
          fileStates: {
            ...state.fileStates,
            [key]: {
              ...(state.fileStates[key] ?? DEFAULT_FILE_STATE),
              editorScrollRatio,
              previewScrollRatio,
            },
          },
        }))
      },
    }),
    {
      name: 'markdown-editor-ui',
      partialize: (state) => ({
        theme: state.theme,
        outlineExpanded: state.outlineExpanded,
        webDocExpanded: state.webDocExpanded,
        fileTreeExpanded: state.fileTreeExpanded,
        sidebarVisible: state.sidebarVisible,
        fileStates: state.fileStates,
      }),
    },
  ),
)

/** 读取单文件 UI 状态；须用 useShallow，避免 getFileState 每次返回新对象导致无限重渲染 */
export function useFileUiState(filePath?: string, workspaceId?: string): FileUiState {
  const defaultViewMode = useAppSettingsStore((state) => state.defaultViewMode)

  return useEditorUiStore(
    useShallow((state) => {
      const key = resolveFileKey(filePath, workspaceId)
      const stored = state.fileStates[key]
      if (stored) return stored
      return { ...DEFAULT_FILE_STATE, viewMode: defaultViewMode }
    }),
  )
}
