import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  AUTO_SAVE_INTERVAL_OPTIONS,
  DEFAULT_VIEW_MODE_OPTIONS,
  EDITOR_FONT_SIZE_OPTION_LABELS,
  PREVIEW_DEBOUNCE_OPTIONS,
  READER_FONT_SIZE_OPTION_LABELS,
  READER_LINE_HEIGHT_OPTION_LABELS,
  RECENT_FILES_LIMIT_OPTIONS,
  TAB_SIZE_OPTION_LABELS,
  PDF_OCR_SCALE_OPTION_LABELS,
  useAppSettingsStore,
  type AutoSaveIntervalMs,
  type EditorFontSize,
  type EditorTabSize,
  type PreviewDebounceMs,
  type RecentFilesLimit,
  type ReaderFontSize,
  type ReaderLineHeight,
  type PdfOcrScale,
} from '@/stores/app-settings-store'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import type { AppTheme } from '@/stores/editor-ui-store'
import type { EditorViewMode } from '@/stores/editor-ui-store'
import { cn } from '@/lib/utils'
import { appApi } from '@/api/app-api'
import { clearAllPdfOcrCache } from '@/api/ocr-api'
import { useOcrComponent } from '@/hooks/reader/useOcrComponent'
import { SyncSettingsSection } from './SyncSettingsSection'
import { TtsSettingsSection } from './TtsSettingsSection'
import { toast } from 'sonner'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenErrorLog: () => void
  onOpenAbout: () => void
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 transform rounded-full bg-background transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

function OptionButtons<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {options.map((option) => (
        <Button
          key={String(option.value)}
          type="button"
          size="xs"
          variant={value === option.value ? 'default' : 'outline'}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, onOpenErrorLog, onOpenAbout }: SettingsDialogProps) {
  const theme = useEditorUiStore((state) => state.theme)
  const setTheme = useEditorUiStore((state) => state.setTheme)

  const autoSaveEnabled = useAppSettingsStore((state) => state.autoSaveEnabled)
  const autoSaveIntervalMs = useAppSettingsStore((state) => state.autoSaveIntervalMs)
  const maxRecentFiles = useAppSettingsStore((state) => state.maxRecentFiles)
  const recentFiles = useAppSettingsStore((state) => state.recentFiles)
  const setAutoSaveEnabled = useAppSettingsStore((state) => state.setAutoSaveEnabled)
  const setAutoSaveIntervalMs = useAppSettingsStore((state) => state.setAutoSaveIntervalMs)
  const setMaxRecentFiles = useAppSettingsStore((state) => state.setMaxRecentFiles)
  const clearRecentFiles = useAppSettingsStore((state) => state.clearRecentFiles)
  const defaultViewMode = useAppSettingsStore((state) => state.defaultViewMode)
  const previewDebounceMs = useAppSettingsStore((state) => state.previewDebounceMs)
  const restoreLastFileOnStartup = useAppSettingsStore((state) => state.restoreLastFileOnStartup)
  const setDefaultViewMode = useAppSettingsStore((state) => state.setDefaultViewMode)
  const setPreviewDebounceMs = useAppSettingsStore((state) => state.setPreviewDebounceMs)
  const setRestoreLastFileOnStartup = useAppSettingsStore((state) => state.setRestoreLastFileOnStartup)
  const tabSize = useAppSettingsStore((state) => state.tabSize)
  const editorFontSize = useAppSettingsStore((state) => state.editorFontSize)
  const setTabSize = useAppSettingsStore((state) => state.setTabSize)
  const setEditorFontSize = useAppSettingsStore((state) => state.setEditorFontSize)
  const readerFontSize = useAppSettingsStore((state) => state.readerFontSize)
  const readerLineHeight = useAppSettingsStore((state) => state.readerLineHeight)
  const setReaderFontSize = useAppSettingsStore((state) => state.setReaderFontSize)
  const setReaderLineHeight = useAppSettingsStore((state) => state.setReaderLineHeight)
  const pdfOcrBackgroundPrefetch = useAppSettingsStore((state) => state.pdfOcrBackgroundPrefetch)
  const setPdfOcrBackgroundPrefetch = useAppSettingsStore((state) => state.setPdfOcrBackgroundPrefetch)
  const pdfOcrAgentAutoOcr = useAppSettingsStore((state) => state.pdfOcrAgentAutoOcr)
  const setPdfOcrAgentAutoOcr = useAppSettingsStore((state) => state.setPdfOcrAgentAutoOcr)
  const pdfOcrScale = useAppSettingsStore((state) => state.pdfOcrScale)
  const setPdfOcrScale = useAppSettingsStore((state) => state.setPdfOcrScale)
  const verboseRendererLogs = useAppSettingsStore((state) => state.verboseRendererLogs)
  const setVerboseRendererLogs = useAppSettingsStore((state) => state.setVerboseRendererLogs)
  const [clearingOcrCache, setClearingOcrCache] = useState(false)
  const {
    status: ocrComponentStatus,
    loading: ocrComponentLoading,
    download: downloadOcrComponent,
    cancel: cancelOcrComponentDownload,
  } = useOcrComponent(open)

  const ocrComponentPhaseLabel =
    ocrComponentStatus.phase === 'ready'
      ? '已就绪'
      : ocrComponentStatus.phase === 'downloading'
        ? `${ocrComponentStatus.progress}%`
        : ocrComponentStatus.phase === 'error'
          ? '失败'
          : '未安装'

  const handleClearAllOcrCache = async () => {
    if (
      !window.confirm(
        '将清除所有 PDF 的正文页与目录 OCR 缓存。已打开的文件需重新识别，是否继续？',
      )
    ) {
      return
    }
    setClearingOcrCache(true)
    try {
      const result = await clearAllPdfOcrCache()
      if (result.ok) {
        toast.success('已清除全部 OCR 缓存')
      } else {
        toast.error(result.error.message)
      }
    } finally {
      setClearingOcrCache(false)
    }
  }

  const themeOptions: Array<{ value: AppTheme; label: string }> = [
    { value: 'light', label: '纸质白' },
    { value: 'sepia', label: '羊皮纸' },
    { value: 'dark', label: '石墨黑' },
  ]

  const recentLimitOptions = RECENT_FILES_LIMIT_OPTIONS.map((value) => ({
    value,
    label: String(value),
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>编辑器偏好与应用行为，修改后自动保存到本地。</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto pr-1">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">编辑器</h3>
            <SettingRow
              title="自动保存"
              description="仅对已保存到磁盘的文件生效；未命名文档需先另存为。"
            >
              <ToggleSwitch
                checked={autoSaveEnabled}
                onChange={setAutoSaveEnabled}
                label="自动保存"
              />
            </SettingRow>
            <SettingRow title="自动保存间隔" description={autoSaveEnabled ? '按设定间隔写入文件' : '启用自动保存后可配置'}>
              <OptionButtons<AutoSaveIntervalMs>
                value={autoSaveIntervalMs}
                options={AUTO_SAVE_INTERVAL_OPTIONS}
                onChange={setAutoSaveIntervalMs}
              />
            </SettingRow>
            <SettingRow title="默认视图模式" description="无历史记录的新文档或文件首次打开时使用。">
              <OptionButtons<EditorViewMode>
                value={defaultViewMode}
                options={DEFAULT_VIEW_MODE_OPTIONS}
                onChange={setDefaultViewMode}
              />
            </SettingRow>
            <SettingRow title="预览刷新延迟" description="停止输入后更新预览的等待时间。">
              <OptionButtons<PreviewDebounceMs>
                value={previewDebounceMs}
                options={PREVIEW_DEBOUNCE_OPTIONS}
                onChange={setPreviewDebounceMs}
              />
            </SettingRow>
            <SettingRow title="Tab 宽度" description="影响缩进显示与 Tab 键插入的空格数。">
              <OptionButtons<EditorTabSize>
                value={tabSize}
                options={TAB_SIZE_OPTION_LABELS}
                onChange={setTabSize}
              />
            </SettingRow>
            <SettingRow title="编辑器字号" description="仅作用于 CodeMirror 编辑区。">
              <OptionButtons<EditorFontSize>
                value={editorFontSize}
                options={EDITOR_FONT_SIZE_OPTION_LABELS}
                onChange={setEditorFontSize}
              />
            </SettingRow>
          </section>

          <Separator className="my-2" />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">阅读</h3>
            <SettingRow title="电子书字号" description="作用于 EPUB、MOBI、AZW3 和 AZW 正文；顶部工具栏也可快速调整。">
              <OptionButtons<ReaderFontSize>
                value={readerFontSize}
                options={READER_FONT_SIZE_OPTION_LABELS}
                onChange={setReaderFontSize}
              />
            </SettingRow>
            <SettingRow title="电子书行距" description="作用于 EPUB、MOBI、AZW3 和 AZW 正文。">
              <OptionButtons<ReaderLineHeight>
                value={readerLineHeight}
                options={READER_LINE_HEIGHT_OPTION_LABELS}
                onChange={setReaderLineHeight}
              />
            </SettingRow>
            <SettingRow
              title="OCR 组件"
              description={
                ocrComponentStatus.message ??
                (ocrComponentStatus.phase === 'ready'
                  ? '识别引擎已就绪（PP-OCR 内置中英文字库，可离线识别）。'
                  : '首次识别前需下载（不会自动开始）。')
              }
            >
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">
                  {ocrComponentPhaseLabel}
                  {!ocrComponentStatus.runtimeReady && ocrComponentStatus.phase !== 'ready'
                    ? ' · 缺运行时'
                    : ''}
                </span>
                {ocrComponentStatus.phase === 'downloading' ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void cancelOcrComponentDownload()}
                  >
                    取消
                  </Button>
                ) : ocrComponentStatus.phase !== 'ready' ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={ocrComponentLoading}
                    onClick={() => {
                      void downloadOcrComponent().then((result) => {
                        if (!result.ok && result.error.code !== 'CANCELLED') {
                          toast.error(result.error.message)
                        } else if (result.ok) {
                          toast.success('OCR 组件已就绪')
                        }
                      })
                    }}
                  >
                    {ocrComponentLoading ? '下载中…' : '下载'}
                  </Button>
                ) : null}
              </div>
            </SettingRow>
            <SettingRow
              title="PDF 后台预识别"
              description="扫描版 PDF 在后台识别当前章邻近页，减少翻页等待；默认关闭，不打开文件即全书识别。"
            >
              <ToggleSwitch
                checked={pdfOcrBackgroundPrefetch}
                onChange={setPdfOcrBackgroundPrefetch}
                label="PDF 后台预识别"
              />
            </SettingRow>
            <SettingRow
              title="PDF OCR 精度"
              description="越高识别越清晰但更慢；修改后建议清除 OCR 缓存并重新识别。"
            >
              <OptionButtons<PdfOcrScale>
                value={pdfOcrScale}
                options={PDF_OCR_SCALE_OPTION_LABELS}
                onChange={setPdfOcrScale}
              />
            </SettingRow>
            <SettingRow
              title="Agent 自动识别"
              description="Agent 读扫描版正文时自动 OCR 未识别页；关闭后需手动点工具栏「识别本页」。"
            >
              <ToggleSwitch
                checked={pdfOcrAgentAutoOcr}
                onChange={setPdfOcrAgentAutoOcr}
                label="Agent 自动识别"
              />
            </SettingRow>
            <SettingRow
              title="清除 OCR 缓存"
              description="删除所有已保存的 PDF 正文页与目录识别结果；识别引擎保留在本地。"
            >
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={clearingOcrCache}
                onClick={() => void handleClearAllOcrCache()}
              >
                {clearingOcrCache ? '清除中…' : '全部清除'}
              </Button>
            </SettingRow>
          </section>

          <Separator className="my-2" />

          <SyncSettingsSection />

          <Separator className="my-2" />

          <TtsSettingsSection />

          <Separator className="my-2" />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">外观</h3>
            <SettingRow title="主题" description="同步编辑器、预览与界面配色。">
              <OptionButtons<AppTheme>
                value={theme}
                options={themeOptions}
                onChange={setTheme}
              />
            </SettingRow>
          </section>

          <Separator className="my-2" />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">文件</h3>
            <SettingRow title="最近文件数量" description={`当前已记录 ${recentFiles.length} 个路径`}>
              <OptionButtons<RecentFilesLimit>
                value={maxRecentFiles}
                options={recentLimitOptions}
                onChange={setMaxRecentFiles}
              />
            </SettingRow>
            <SettingRow title="清除最近记录" description="不影响磁盘上的实际文件。">
              <Button type="button" size="xs" variant="outline" onClick={clearRecentFiles}>
                清除
              </Button>
            </SettingRow>
            <SettingRow
              title="启动时恢复上次工作区"
              description="重启或更新后自动回到上次打开的文档、电子书或在线网页（有未保存草稿时优先恢复草稿）。"
            >
              <ToggleSwitch
                checked={restoreLastFileOnStartup}
                onChange={setRestoreLastFileOnStartup}
                label="启动时恢复上次工作区"
              />
            </SettingRow>
          </section>

          <Separator className="my-2" />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">应用</h3>
            <SettingRow title="检查更新" description="从 GitHub Release 获取新版本（打包版支持一键安装）。">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  onOpenAbout()
                }}
              >
                关于
              </Button>
            </SettingRow>
          </section>

          <Separator className="my-2" />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">调试</h3>
            <SettingRow
              title="详细控制台日志"
              description="将渲染进程 Console 转发到启动应用的终端（用于排查黑屏）。"
            >
              <ToggleSwitch
                checked={verboseRendererLogs}
                onChange={setVerboseRendererLogs}
                label="详细控制台日志"
              />
            </SettingRow>
            <SettingRow title="开发者工具" description="快捷键 Ctrl+Shift+I。">
              <Button type="button" size="xs" variant="outline" onClick={() => appApi.toggleDevTools()}>
                打开
              </Button>
            </SettingRow>
            <SettingRow title="错误日志" description="查看本会话错误与磁盘日志路径。">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  onOpenErrorLog()
                }}
              >
                查看
              </Button>
            </SettingRow>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
