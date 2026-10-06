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
  { value: 'editor', label: '编辑' },
  { value: 'split', label: '分屏' },
  { value: 'preview', label: '预览' },
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

export interface AppSettingsState {
  autoSaveEnabled: boolean
  autoSaveIntervalMs: AutoSaveIntervalMs
  maxRecentFiles: RecentFilesLimit
  recentFiles: string[]
  defaultViewMode: EditorViewMode
  previewDebounceMs: PreviewDebounceMs
  restoreLastFileOnStartup: boolean
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
}

interface AppSettingsStore extends AppSettingsState {
  setAutoSaveEnabled: (enabled: boolean) => void
  setAutoSaveIntervalMs: (intervalMs: AutoSaveIntervalMs) => void
  setMaxRecentFiles: (limit: RecentFilesLimit) => void
  setDefaultViewMode: (mode: EditorViewMode) => void
  setPreviewDebounceMs: (ms: PreviewDebounceMs) => void
  setRestoreLastFileOnStartup: (enabled: boolean) => void
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
  addRecentFile: (filePath: string) => void
  removeRecentFile: (filePath: string) => void
  clearRecentFiles: () => void
}

function trimRecentFiles(files: string[], limit: number): string[] {
  return files.slice(0, Math.max(1, limit))
}

export const useAppSettingsStore = create<AppSettingsStore>()(
  persist(
    (set) => ({
      autoSaveEnabled: false,
      autoSaveIntervalMs: 30000,
      maxRecentFiles: 10,
      recentFiles: [],
      defaultViewMode: 'split',
      previewDebounceMs: 300,
      restoreLastFileOnStartup: true,
      lastActiveSurface: 'none',
      lastOpenedFilePath: undefined,
      lastWebDocUrl: undefined,
      lastOpenedFolderPath: undefined,
      lastWorkspaceRoot: undefined,
      tabSize: 2,
      editorFontSize: 15,
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

      setMaxRecentFiles: (limit) =>
        set((state) => ({
          maxRecentFiles: limit,
          recentFiles: trimRecentFiles(state.recentFiles, limit),
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
    }),
    {
      name: 'markdown-editor-settings',
      partialize: (state) => ({
        autoSaveEnabled: state.autoSaveEnabled,
        autoSaveIntervalMs: state.autoSaveIntervalMs,
        maxRecentFiles: state.maxRecentFiles,
        recentFiles: state.recentFiles,
        defaultViewMode: state.defaultViewMode,
        previewDebounceMs: state.previewDebounceMs,
        restoreLastFileOnStartup: state.restoreLastFileOnStartup,
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
          restoreLastFileOnStartup: p.restoreLastFileOnStartup ?? true,
          lastActiveSurface: p.lastActiveSurface ?? 'none',
          pdfOcrBackgroundPrefetch: p.pdfOcrBackgroundPrefetch ?? false,
          pdfOcrAgentAutoOcr: p.pdfOcrAgentAutoOcr ?? true,
          pdfOcrScale: p.pdfOcrScale ?? DEFAULT_PDF_OCR_SCALE,
        }
      },
    },
  ),
)
