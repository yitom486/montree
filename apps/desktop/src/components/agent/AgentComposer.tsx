// Layout reference: beui.dev/components/agents/prompt-input (MIT © 2026 Saurabh Chauhan), see LICENSE.beui.
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit, PromptInputAttachmentBridge, PromptInputAttachments, PromptInputAttachment } from '@/components/ai-elements/prompt-input'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { fileApi } from '@/api/file-api'
import { extractClipboardImage } from '@/lib/editor/codemirror-paste-image'
import {
  ACP_MAX_IMAGE_BYTES,
  toFileUri,
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
import { ArrowUp, Square } from 'lucide-react'
import { AgentContextMenu } from '@/components/agent/chat/AgentContextMenu'

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
    <AgentContextMenu textareaRef={textareaRef} onDraftChange={onDraftChange}>
    <PromptInput onSubmit={() => submit()}
      data-slot="agent-composer"
      className={cn(
        'relative min-w-0 [&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:border-border/70 [&_[data-slot=input-group]]:bg-background [&_[data-slot=input-group]]:shadow-sm',
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

      <PromptInputAttachmentBridge
        files={attachments.map(att => ({ id: att.id, type: 'file' as const, filename: att.name, mediaType: att.mimeType, url: att.previewUrl ?? (att.absolutePath ? toFileUri(att.absolutePath) : '') }))}
        add={files => { void ingestDroppedFiles(Array.from(files)) }}
        remove={removeAttachment}
        clear={() => attachments.forEach(att => removeAttachment(att.id))}
      >
        <PromptInputAttachments className="gap-1.5 px-2 py-1">
          {att => <PromptInputAttachment data={att} className="max-w-full" />}
        </PromptInputAttachments>
      <PromptInputTextarea
        ref={textareaRef}
        className="min-h-16 max-h-40 w-full resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
        aria-label="输入消息，Enter 发送，Shift+Enter 换行"
        placeholder={
          disabled
            ? '暂不可发送（等待连接或认证完成）'
            : workspaceRoot?.trim()
              ? '发送消息… 可拖入文件或粘贴图片'
              : '发送消息… 可直接提问当前网页'
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
      />

      <PromptInputFooter className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 px-2 py-2">
        <div data-slot="agent-composer-controls" className="flex min-w-0 flex-wrap items-center gap-1">{toolbarStart}</div>
        <PromptInputSubmit
          type={prompting ? 'button' : 'submit'}
          status={prompting ? 'streaming' : 'ready'}
          aria-label={prompting ? '停止' : '发送'}
          title={prompting ? '停止' : '发送'}
          className="size-8 shrink-0 self-end rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/85 disabled:opacity-30 motion-reduce:transition-none"
          disabled={!prompting && !canSend}
          onClick={prompting ? onCancel : undefined}
        >{prompting ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}</PromptInputSubmit>
      </PromptInputFooter>
      </PromptInputAttachmentBridge>
    </PromptInput>
    </AgentContextMenu>
  )
}
