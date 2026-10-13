import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EditorViewMode } from '@/stores/editor-ui-store'
import {
  DEFAULT_READER_TYPOGRAPHY,
  type ReaderFontSize,
  type ReaderLineHeight,
} from '@montree/reader-core'
import {
  DEFAULT_PDF_OCR_SCALE,
  PDF_OCR_SCALE_OPTION_LABELS,
  type PdfOcrScale,
} from '@montree/contracts'

export {
  PDF_OCR_SCALE_OPTION_LABELS,
  type PdfOcrScale,
} from '@montree/contracts'

export {
  READER_FONT_SIZE_OPTIONS,
  READER_FONT_SIZE_OPTION_LABELS,
  READER_LINE_HEIGHT_OPTION_LABELS,
  type ReaderFontSize,
  type ReaderLineHeight,
} from '@montree/reader-core'

export type AutoSaveIntervalMs = 15000 | 30000 | 60000
export type PreviewDebounceMs = 150 | 300 | 500
export type WorkspaceActiveSurface = 'none' | 'file' | 'web-doc'
/** Markdown 编辑器内部模式：沉浸式实时预览 / 纯源码 */
export type MarkdownEditorMode = 'live-preview' | 'source'

export const AUTO_SAVE_INTERVAL_OPTIONS: Array<{ value: AutoSaveIntervalMs; label: string }> = [
  { value: 15000, label: '15 秒' },
  { value: 30000, label: '30 秒' },
  { value: 60000, label: '60 秒' },
]

export const PREVIEW_DEBOUNCE_OPTIONS: Array<{ value: PreviewDebounceMs; label: string }> = [
  { value: 150, label: '150 ms' },
  { value: 300, label: '300 ms' },
  { value: 500, label: '500 ms' },
]

export const DEFAULT_VIEW_MODE_OPTIONS: Array<{ value: EditorViewMode; label: string }> = [
  { value: 'editor', label: '单栏编辑' },
  { value: 'split', label: '双栏分屏' },
  { value: 'preview', label: '独立预览' },
]

export const TAB_SIZE_OPTIONS = [2, 4] as const
export type EditorTabSize = (typeof TAB_SIZE_OPTIONS)[number]

export const TAB_SIZE_OPTION_LABELS: Array<{ value: EditorTabSize; label: string }> = [
  { value: 2, label: '2 空格' },
  { value: 4, label: '4 空格' },
]

export const EDITOR_FONT_SIZE_OPTIONS = [13, 15, 17, 19] as const
export type EditorFontSize = (typeof EDITOR_FONT_SIZE_OPTIONS)[number]

export const EDITOR_FONT_SIZE_OPTION_LABELS: Array<{ value: EditorFontSize; label: string }> =
  EDITOR_FONT_SIZE_OPTIONS.map((value) => ({ value, label: `${value}px` }))

export const RECENT_FILES_LIMIT_OPTIONS = [5, 10, 20] as const
export type RecentFilesLimit = (typeof RECENT_FILES_LIMIT_OPTIONS)[number]

/** 工作区身份感知的最近文档条目（workspaceId + 路径双键防串）。 */
export interface RecentDocumentEntry {
  workspaceId: string
  path: string
  openedAt: number
}

export interface AppSettingsState {
  autoSaveEnabled: boolean
  autoSaveIntervalMs: AutoSaveIntervalMs
  maxRecentFiles: RecentFilesLimit
  recentFiles: string[]
  /**
   * 工作区身份感知的最近文档（A1）：同一相对路径在不同工作区是不同条目，
   * 防与裸路径 recentFiles 串用；本机模式两处同时记录。
   */
  recentDocuments: RecentDocumentEntry[]
  defaultViewMode: EditorViewMode
  previewDebounceMs: PreviewDebounceMs
  restoreLastFileOnStartup: boolean
  /** 启动时是否自动恢复上次工作区（包含 WSL / 远程环境） */
  restoreWorkspaceOnStartup: boolean
  /** 上次主区展示：本地文件 / 在线文档 / 无 */
  lastActiveSurface: WorkspaceActiveSurface
  lastOpenedFilePath?: string
  lastWebDocUrl?: string
  lastOpenedFolderPath?: string
  lastWorkspaceRoot?: string
  tabSize: EditorTabSize
  editorFontSize: EditorFontSize
  readerFontSize: ReaderFontSize
  readerLineHeight: ReaderLineHeight
  /** 扫描 PDF 后台预识别当前章邻近页（默认关） */
  pdfOcrBackgroundPrefetch: boolean
  /** Agent 读扫描版正文时自动 OCR 未识别页 */
  pdfOcrAgentAutoOcr: boolean
  /** PDF 页面渲染倍率，影响 OCR 速度与清晰度 */
  pdfOcrScale: PdfOcrScale
  verboseRendererLogs: boolean
  /** Markdown 编辑器内部模式：沉浸式实时预览 / 纯源码 */
  markdownEditorMode: MarkdownEditorMode
}

interface AppSettingsStore extends AppSettingsState {
  setAutoSaveEnabled: (enabled: boolean) => void
  setAutoSaveIntervalMs: (intervalMs: AutoSaveIntervalMs) => void
  setMaxRecentFiles: (limit: RecentFilesLimit) => void
  setDefaultViewMode: (mode: EditorViewMode) => void
  setPreviewDebounceMs: (ms: PreviewDebounceMs) => void
  setRestoreLastFileOnStartup: (enabled: boolean) => void
  setRestoreWorkspaceOnStartup: (enabled: boolean) => void
  setLastActiveSurface: (surface: WorkspaceActiveSurface) => void
  setLastOpenedFilePath: (filePath?: string) => void
  setLastWebDocUrl: (url?: string) => void
  setLastOpenedFolderPath: (folderPath?: string) => void
  setLastWorkspaceRoot: (rootPath?: string) => void
  setTabSize: (tabSize: EditorTabSize) => void
  setEditorFontSize: (fontSize: EditorFontSize) => void
  setReaderFontSize: (fontSize: ReaderFontSize) => void
  setReaderLineHeight: (lineHeight: ReaderLineHeight) => void
  setPdfOcrBackgroundPrefetch: (enabled: boolean) => void
  setPdfOcrAgentAutoOcr: (enabled: boolean) => void
  setPdfOcrScale: (scale: PdfOcrScale) => void
  setVerboseRendererLogs: (enabled: boolean) => void
  setMarkdownEditorMode: (mode: MarkdownEditorMode) => void
  toggleMarkdownEditorMode: () => void
  addRecentFile: (filePath: string) => void
  removeRecentFile: (filePath: string) => void
  clearRecentFiles: () => void
  addRecentDocument: (workspaceId: string, filePath: string) => void
  removeRecentDocument: (workspaceId: string, filePath: string) => void
  clearRecentDocuments: () => void
}

function trimRecentFiles<T>(files: T[], limit: number): T[] {
  return files.slice(0, Math.max(1, limit))
}

export const useAppSettingsStore = create<AppSettingsStore>()(
  persist(
    (set) => ({
      autoSaveEnabled: false,
      autoSaveIntervalMs: 30000,
      maxRecentFiles: 10,
      recentFiles: [],
      recentDocuments: [],
      defaultViewMode: 'editor',
      previewDebounceMs: 300,
      restoreLastFileOnStartup: true,
      restoreWorkspaceOnStartup: true,
      lastActiveSurface: 'none',
      lastOpenedFilePath: undefined,
      lastWebDocUrl: undefined,
      lastOpenedFolderPath: undefined,
      lastWorkspaceRoot: undefined,
      tabSize: 2,
      editorFontSize: 15,
      markdownEditorMode: 'live-preview',
      readerFontSize: DEFAULT_READER_TYPOGRAPHY.fontSize,
      readerLineHeight: DEFAULT_READER_TYPOGRAPHY.lineHeight,
      pdfOcrBackgroundPrefetch: false,
      pdfOcrAgentAutoOcr: true,
      pdfOcrScale: DEFAULT_PDF_OCR_SCALE,
      verboseRendererLogs: false,

      setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),

      setAutoSaveIntervalMs: (intervalMs) => set({ autoSaveIntervalMs: intervalMs }),

      setDefaultViewMode: (mode) => set({ defaultViewMode: mode }),

      setPreviewDebounceMs: (ms) => set({ previewDebounceMs: ms }),

      setRestoreLastFileOnStartup: (enabled) => set({ restoreLastFileOnStartup: enabled }),

      setRestoreWorkspaceOnStartup: (enabled) => set({ restoreWorkspaceOnStartup: enabled }),

      setLastActiveSurface: (surface) => set({ lastActiveSurface: surface }),

      setLastOpenedFilePath: (filePath) =>
        set({
          lastOpenedFilePath: filePath,
          ...(filePath ? { lastActiveSurface: 'file' as const } : {}),
        }),

      setLastWebDocUrl: (url) =>
        set({
          lastWebDocUrl: url,
          ...(url ? { lastActiveSurface: 'web-doc' as const } : {}),
        }),

      setLastOpenedFolderPath: (folderPath) => set({ lastOpenedFolderPath: folderPath }),

      setLastWorkspaceRoot: (rootPath) => set({ lastWorkspaceRoot: rootPath }),

      setTabSize: (tabSize) => set({ tabSize }),

      setEditorFontSize: (fontSize) => set({ editorFontSize: fontSize }),

      setReaderFontSize: (fontSize) => set({ readerFontSize: fontSize }),

      setReaderLineHeight: (lineHeight) => set({ readerLineHeight: lineHeight }),

      setPdfOcrBackgroundPrefetch: (enabled) => set({ pdfOcrBackgroundPrefetch: enabled }),

      setPdfOcrAgentAutoOcr: (enabled) => set({ pdfOcrAgentAutoOcr: enabled }),

      setPdfOcrScale: (scale) => set({ pdfOcrScale: scale }),

      setVerboseRendererLogs: (enabled) => set({ verboseRendererLogs: enabled }),
      setMarkdownEditorMode: (mode) => set({ markdownEditorMode: mode }),
      toggleMarkdownEditorMode: () =>
        set((state) => ({
          markdownEditorMode: state.markdownEditorMode === 'live-preview' ? 'source' : 'live-preview',
        })),

      setMaxRecentFiles: (limit) =>
        set((state) => ({
          maxRecentFiles: limit,
          recentFiles: trimRecentFiles(state.recentFiles, limit),
          recentDocuments: trimRecentFiles(state.recentDocuments, limit),
        })),

      addRecentFile: (filePath) =>
        set((state) => {
          const normalized = filePath.trim()
          if (!normalized) return state

          const next = [normalized, ...state.recentFiles.filter((item) => item !== normalized)]
          return {
            recentFiles: trimRecentFiles(next, state.maxRecentFiles),
          }
        }),

      removeRecentFile: (filePath) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter((item) => item !== filePath),
        })),

      clearRecentFiles: () => set({ recentFiles: [] }),

      addRecentDocument: (workspaceId, filePath) =>
        set((state) => {
          const path = filePath.trim()
          const scope = workspaceId.trim()
          if (!path || !scope) return state

          const next = [
            { workspaceId: scope, path, openedAt: Date.now() },
            ...state.recentDocuments.filter(
              (item) => !(item.workspaceId === scope && item.path === path),
            ),
          ]
          return {
            recentDocuments: trimRecentFiles(next, state.maxRecentFiles),
          }
        }),

      removeRecentDocument: (workspaceId, filePath) =>
        set((state) => ({
          recentDocuments: state.recentDocuments.filter(
            (item) => !(item.workspaceId === workspaceId && item.path === filePath),
          ),
        })),

      clearRecentDocuments: () => set({ recentDocuments: [] }),
    }),
    {
      name: 'markdown-editor-settings',
      partialize: (state) => ({
        autoSaveEnabled: state.autoSaveEnabled,
        autoSaveIntervalMs: state.autoSaveIntervalMs,
        maxRecentFiles: state.maxRecentFiles,
        recentFiles: state.recentFiles,
        recentDocuments: state.recentDocuments,
        defaultViewMode: state.defaultViewMode,
        previewDebounceMs: state.previewDebounceMs,
        restoreLastFileOnStartup: state.restoreLastFileOnStartup,
        restoreWorkspaceOnStartup: state.restoreWorkspaceOnStartup,
        lastActiveSurface: state.lastActiveSurface,
        lastOpenedFilePath: state.lastOpenedFilePath,
        lastWebDocUrl: state.lastWebDocUrl,
        lastOpenedFolderPath: state.lastOpenedFolderPath,
        lastWorkspaceRoot: state.lastWorkspaceRoot,
        tabSize: state.tabSize,
        editorFontSize: state.editorFontSize,
        readerFontSize: state.readerFontSize,
        readerLineHeight: state.readerLineHeight,
        pdfOcrBackgroundPrefetch: state.pdfOcrBackgroundPrefetch,
        pdfOcrAgentAutoOcr: state.pdfOcrAgentAutoOcr,
        pdfOcrScale: state.pdfOcrScale,
        verboseRendererLogs: state.verboseRendererLogs,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppSettingsState>
        return {
          ...current,
          ...p,
          // Older settings persisted source mode; every launch starts in live preview.
          markdownEditorMode: 'live-preview',
          restoreLastFileOnStartup: p.restoreLastFileOnStartup ?? true,
          restoreWorkspaceOnStartup: p.restoreWorkspaceOnStartup ?? true,
          lastActiveSurface: p.lastActiveSurface ?? 'none',
          pdfOcrBackgroundPrefetch: p.pdfOcrBackgroundPrefetch ?? false,
          pdfOcrAgentAutoOcr: p.pdfOcrAgentAutoOcr ?? true,
          pdfOcrScale: p.pdfOcrScale ?? DEFAULT_PDF_OCR_SCALE,
        }
      },
    },
  ),
)
