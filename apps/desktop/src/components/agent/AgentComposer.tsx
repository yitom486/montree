import { ArrowUp, FileIcon, ImageIcon, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { fileApi } from '@/api/file-api'
import { Button } from '@/components/ui/button'
import { extractClipboardImage } from '@/lib/editor/codemirror-paste-image'
import {
  ACP_MAX_IMAGE_BYTES,
  attachmentToMessageMeta,
  blobToBase64,
  buildAcpPromptBlocks,
  canSendComposer,
  dataTransferHasWorkspacePaths,
  fileNameFromPath,
  isImageMimeType,
  isPathInsideWorkspace,
  mimeFromFileName,
  newAttachmentId,
  normalizePathForCompare,
  readWorkspacePathsFromDataTransfer,
  type AcpMessageAttachment,
  type ComposerAttachment,
} from '@/lib/agent/acp-composer'
import { cn } from '@/lib/utils'
import { isOk } from '@montree/contracts'
import type { AcpContentBlock, AcpPromptCapabilities } from '@montree/contracts'
import { toast } from 'sonner'

export interface AgentComposerSubmitPayload {
  text: string
  prompt: AcpContentBlock[]
  messageAttachments: AcpMessageAttachment[]
}

interface AgentComposerProps {
  disabled: boolean
  prompting: boolean
  workspaceRoot?: string
  promptCapabilities: AcpPromptCapabilities
  draft: string
  onDraftChange: (value: string) => void
  onSubmit: (payload: AgentComposerSubmitPayload) => void
  onCancel: () => void
  toolbarStart: ReactNode
}

function filePathFromFile(file: File): string | undefined {
  const withPath = file as File & { path?: string }
  return typeof withPath.path === 'string' && withPath.path ? withPath.path : undefined
}

export function AgentComposer({
  disabled,
  prompting,
  workspaceRoot,
  promptCapabilities,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  toolbarStart,
}: AgentComposerProps) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const attachmentsRef = useRef(attachments)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  attachmentsRef.current = attachments
  const composerFocusNonce = useAcpUiStore((state) => state.composerFocusNonce)

  /** 拖入/粘贴附件后聚焦输入末尾，便于立刻打字；不影响继续拖贴 */
  const focusComposerEnd = useCallback(() => {
    const el = textareaRef.current
    if (!el || el.disabled) return
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true })
      const len = el.value.length
      try {
        el.setSelectionRange(len, len)
      } catch {
        /* 部分环境下 disabled 切换瞬间可能抛错，忽略即可 */
      }
    })
  }, [])

  useEffect(() => {
    if (composerFocusNonce === 0) return
    focusComposerEnd()
  }, [composerFocusNonce, focusComposerEnd])

  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(att.previewUrl)
      }
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  const addAttachments = useCallback(
    (next: ComposerAttachment[]) => {
      if (next.length === 0) return
      setAttachments((prev) => {
        const seen = new Set(
          prev
            .map((a) => a.absolutePath)
            .filter((p): p is string => Boolean(p))
            .map(normalizePathForCompare),
        )
        const merged = [...prev]
        for (const att of next) {
          const key = att.absolutePath ? normalizePathForCompare(att.absolutePath) : ''
          if (key && seen.has(key)) {
            if (att.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(att.previewUrl)
            continue
          }
          if (key) seen.add(key)
          merged.push(att)
        }
        return merged
      })
      focusComposerEnd()
    },
    [focusComposerEnd],
  )

  const ingestWorkspacePaths = useCallback(
    (paths: string[]) => {
      if (!workspaceRoot?.trim()) {
        toast.error('请先打开工作区后再附加文件')
        return
      }

      const next: ComposerAttachment[] = []
      for (const absolutePath of paths) {
        if (!isPathInsideWorkspace(absolutePath, workspaceRoot)) {
          toast.error(`文件须在工作区内：${fileNameFromPath(absolutePath)}`)
          continue
        }
        const name = fileNameFromPath(absolutePath)
        const mime = mimeFromFileName(name)
        next.push({
          id: newAttachmentId(),
          kind: isImageMimeType(mime) ? 'image' : 'file',
          name,
          mimeType: mime,
          absolutePath,
        })
      }
      addAttachments(next)
    },
    [addAttachments, workspaceRoot],
  )

  const ingestImageBlob = useCallback(
    async (blob: Blob, mimeType: string, nameHint?: string) => {
      if (!isImageMimeType(mimeType)) {
        toast.error('不支持的图片格式')
        return
      }
      if (blob.size > ACP_MAX_IMAGE_BYTES) {
        toast.error('图片过大（上限 8MB）')
        return
      }

      const base64 = await blobToBase64(blob)
      const previewUrl = URL.createObjectURL(blob)
      const name = nameHint ?? `paste-${Date.now()}.${mimeType.split('/')[1] ?? 'png'}`
      const canImage = promptCapabilities.image === true

      let absolutePath: string | undefined
      if (!canImage) {
        if (!workspaceRoot?.trim()) {
          URL.revokeObjectURL(previewUrl)
          toast.error('请先打开工作区后再附加图片')
          return
        }
        const saved = await fileApi.savePastedImage({
          workspaceRoot,
          base64,
          mimeType,
        })
        if (!isOk(saved)) {
          URL.revokeObjectURL(previewUrl)
          toast.error(saved.error.message)
          return
        }
        absolutePath = saved.value.absolutePath
      }

      addAttachments([
        {
          id: newAttachmentId(),
          kind: 'image',
          name,
          mimeType,
          size: blob.size,
          previewUrl,
          base64: canImage ? base64 : undefined,
          absolutePath,
        },
      ])
    },
    [addAttachments, promptCapabilities.image, workspaceRoot],
  )

  const ingestDroppedFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      if (files.length === 0) return

      for (const file of files) {
        const path = filePathFromFile(file)
        const mime = file.type || mimeFromFileName(file.name)

        if (isImageMimeType(mime)) {
          if (file.size > ACP_MAX_IMAGE_BYTES) {
            toast.error(`${file.name} 过大（上限 8MB）`)
            continue
          }
          if (
            promptCapabilities.image !== true &&
            path &&
            workspaceRoot?.trim() &&
            isPathInsideWorkspace(path, workspaceRoot)
          ) {
            addAttachments([
              {
                id: newAttachmentId(),
                kind: 'image',
                name: file.name,
                mimeType: mime,
                absolutePath: path,
                size: file.size,
                previewUrl: URL.createObjectURL(file),
              },
            ])
            continue
          }
          await ingestImageBlob(file, mime, file.name)
          continue
        }

        if (!path) {
          toast.error(`无法获取 ${file.name} 的本地路径`)
          continue
        }
        if (!workspaceRoot?.trim()) {
          toast.error('请先打开工作区后再附加文件')
          continue
        }
        if (!isPathInsideWorkspace(path, workspaceRoot)) {
          toast.error(`文件须在工作区内：${file.name}`)
          continue
        }

        addAttachments([
          {
            id: newAttachmentId(),
            kind: 'file',
            name: file.name,
            mimeType: mime,
            absolutePath: path,
            size: file.size,
          },
        ])
      }
    },
    [addAttachments, ingestImageBlob, promptCapabilities.image, workspaceRoot],
  )

  const submit = useCallback(() => {
    if (disabled || prompting) return
    if (!canSendComposer(draft, attachments)) return

    const prompt = buildAcpPromptBlocks({
      text: draft,
      attachments,
      promptCapabilities,
    })
    if (prompt.length === 0) {
      toast.error('没有可发送的内容')
      return
    }

    onSubmit({
      text: draft.trim(),
      prompt,
      messageAttachments: attachments.map(attachmentToMessageMeta),
    })
    // previewUrl 交给气泡展示，此处不 revoke
    setAttachments([])
    onDraftChange('')
  }, [
    attachments,
    disabled,
    draft,
    onDraftChange,
    onSubmit,
    prompting,
    promptCapabilities,
  ])

  const canSend = !disabled && !prompting && canSendComposer(draft, attachments)

  return (
    <div
      className={cn(
        'relative rounded-2xl border border-border/70 bg-background shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
        dragOver && 'border-emerald-500/60 ring-2 ring-emerald-500/20',
      )}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        const hasWorkspace = dataTransferHasWorkspacePaths(e.dataTransfer)
        const hasFiles = e.dataTransfer.types.includes('Files')
        if (hasWorkspace || hasFiles) setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (disabled) return
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        if (disabled) return
        const workspacePaths = readWorkspacePathsFromDataTransfer(e.dataTransfer)
        if (workspacePaths.length > 0) {
          ingestWorkspacePaths(workspacePaths)
          focusComposerEnd()
          return
        }
        void ingestDroppedFiles(e.dataTransfer.files).finally(() => {
          focusComposerEnd()
        })
      }}
    >
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-emerald-500/10 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          松开以附加文件引用
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border/40 px-2.5 pt-2.5 pb-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="group inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 py-0.5 pr-0.5 pl-1.5 text-[10px] text-sky-800 dark:text-sky-200"
            >
              {att.kind === 'image' && att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt=""
                  className="size-5 shrink-0 rounded object-cover"
                />
              ) : att.kind === 'image' ? (
                <ImageIcon className="size-3 shrink-0 opacity-80" />
              ) : (
                <FileIcon className="size-3 shrink-0 opacity-80" />
              )}
              <span className="min-w-0 truncate font-medium" title={att.absolutePath ?? att.name}>
                {att.name}
              </span>
              <button
                type="button"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-sky-700/70 hover:bg-sky-500/15 hover:text-sky-900 dark:text-sky-200/70 dark:hover:text-sky-100"
                title="移除"
                onClick={() => removeAttachment(att.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className="min-h-[72px] w-full resize-none bg-transparent px-3 py-2.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
        placeholder={
          disabled
            ? '暂不可发送（等待连接或认证完成）'
            : workspaceRoot?.trim()
              ? '输入消息，Enter 发送 · 未连接时将自动连接 · 可拖入文件或粘贴图片'
              : '输入消息，Enter 发送 · 网页会话可直接提问当前页 · 附加本地文件需先打开文件夹'
        }
        value={draft}
        disabled={disabled}
        onChange={(e) => onDraftChange(e.target.value)}
        onPaste={(e) => {
          const image = extractClipboardImage(e.clipboardData?.items)
          if (!image) return
          e.preventDefault()
          void ingestImageBlob(image.blob, image.mimeType).finally(() => {
            focusComposerEnd()
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />

      <div className="flex items-center gap-0.5 border-t border-border/40 px-1.5 py-1">
        {toolbarStart}
        {prompting ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 shrink-0 rounded-full"
            title="停止"
            onClick={onCancel}
          >
            <Square className="size-3" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="size-7 shrink-0 rounded-full"
            title="发送"
            disabled={!canSend}
            onClick={submit}
          >
            <ArrowUp className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
