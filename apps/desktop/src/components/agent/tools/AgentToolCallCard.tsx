import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  FileText,
  FolderInput,
  Globe,
  Loader2,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import {
  AgentChatItem,
  AgentChatItemBody,
  AGENT_CHAT_PRE_CLASS,
  useAgentChatOpen,
} from '@/components/agent/chat/AgentChatItem'
import { AgentDiffPreview } from '@/components/agent/tools/AgentDiffPreview'
import { AgentPermissionCard } from '@/components/agent/permission/AgentPermissionCard'
import { Button } from '@/components/ui/button'
import { toolMessageNeedsApproval } from '@/lib/agent/acp-permission-ui'
import { isProposeMarkToolTitle } from '@/lib/agent/parse-mark-proposal'
import {
  classifyMarkProposalFailure,
  openChapterForMarkRecovery,
  promptSelectTextForMarkRecovery,
} from '@/lib/agent/mark-proposal-failure'
import { explainToolFailure } from '@/lib/agent/tool-failure-message'
import { toast } from 'sonner'
import {
  DiagramViewerCard,
  type DiagramPayload,
} from '@/components/agent/tools/DiagramViewerCard'
import {
  CrossReferenceCard,
  type CrossReferencePayload,
} from '@/components/agent/tools/CrossReferenceCard'
import {
  ContentAuditCard,
  type ContentAuditPayload,
} from '@/components/agent/tools/ContentAuditCard'
import {
  ChapterSuggestionCard,
  type SuggestChaptersPayload,
} from '@/components/agent/tools/ChapterSuggestionCard'
import {
  isToolActiveStatus,
  type AcpChatMessage,
  type AcpToolLocation,
} from '@/stores/acp-chat-types'
import { useAcpPendingPermission } from '@/stores/acp-ui-store'

function parseDiagramPayload(text?: string, title?: string): DiagramPayload | null {
  if (!text || (!text.includes('mermaidCode') && !title?.includes('montree_generate_diagram'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && typeof obj.mermaidCode === 'string') {
      return obj as DiagramPayload
    }
  } catch {
    return null
  }
  return null
}

function parseCrossReferencePayload(text?: string, title?: string): CrossReferencePayload | null {
  if (
    !text ||
    (!text.includes('chapterDistribution') && !title?.includes('montree_cross_reference'))
  ) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (
      obj &&
      typeof obj === 'object' &&
      Array.isArray(obj.chapterDistribution) &&
      typeof obj.entity === 'string'
    ) {
      return obj as CrossReferencePayload
    }
  } catch {
    return null
  }
  return null
}

function parseContentAuditPayload(text?: string, title?: string): ContentAuditPayload | null {
  if (!text || (!text.includes('"hits"') && !title?.includes('montree_inspect_content'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && Array.isArray(obj.hits) && typeof obj.query === 'string') {
      return obj as ContentAuditPayload
    }
  } catch {
    return null
  }
  return null
}

function parseSuggestChaptersPayload(text?: string, title?: string): SuggestChaptersPayload | null {
  if (!text || (!text.includes('"chapters"') && !title?.includes('montree_suggest_chapters'))) {
    return null
  }
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && Array.isArray(obj.chapters)) {
      return obj as SuggestChaptersPayload
    }
  } catch {
    return null
  }
  return null
}

function kindIcon(kind: string | undefined): ReactNode {
  const className = 'size-3.5 shrink-0'
  switch (kind) {
    case 'read':
      return <FileText className={className} />
    case 'edit':
      return <FilePenLine className={className} />
    case 'delete':
      return <Trash2 className={className} />
    case 'move':
      return <FolderInput className={className} />
    case 'search':
      return <Search className={className} />
    case 'execute':
      return <Terminal className={className} />
    case 'think':
      return <Sparkles className={className} />
    case 'fetch':
      return <Globe className={className} />
    default:
      return <Wrench className={className} />
  }
}

function statusIcon(status: string | undefined, streaming?: boolean): ReactNode {
  if (streaming || isToolActiveStatus(status)) {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500" />
  }
  if (status === 'failed') {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />
  }
  if (status === 'cancelled') {
    return <XCircle className="size-3.5 shrink-0 text-muted-foreground" />
  }
  return <Check className="size-3.5 shrink-0 text-emerald-500" />
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

interface AgentToolCallCardProps {
  message: AcpChatMessage
}

export function AgentToolCallCard({ message }: AgentToolCallCardProps) {
  const pendingPermission = useAcpPendingPermission()
  const needsApproval = toolMessageNeedsApproval(message, pendingPermission)
  const diffs = message.toolDiffs ?? []
  const detail = message.toolContentText || message.text
  const diagramPayload = useMemo(
    () => parseDiagramPayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const crossRefPayload = useMemo(
    () => parseCrossReferencePayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const auditPayload = useMemo(
    () => parseContentAuditPayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const suggestionPayload = useMemo(
    () => parseSuggestChaptersPayload(detail, message.toolTitle),
    [detail, message.toolTitle],
  )
  const active =
    Boolean(message.streaming) ||
    isToolActiveStatus(message.toolStatus) ||
    needsApproval ||
    Boolean(diagramPayload) ||
    Boolean(crossRefPayload) ||
    Boolean(auditPayload) ||
    Boolean(suggestionPayload)
  const [open, setOpen] = useAgentChatOpen(active)
  const locations = message.toolLocations ?? []
  const failed = message.toolStatus === 'failed'
  const failureExplain = failed
    ? explainToolFailure(
        detail && detail !== message.toolTitle ? detail : '',
        message.toolTitle,
      )
    : null
  const proposeFailed =
    failed &&
    (isProposeMarkToolTitle(message.toolTitle) ||
      /propose.?mark|suggest.?chapters/i.test(message.toolTitle ?? ''))
  const failureGuide = proposeFailed
    ? classifyMarkProposalFailure(detail || message.toolTitle || '标记定位失败')
    : null
  // 失败时用业务说明，不再把原始报错塞进 pre
  const hasTextDetail =
    Boolean(detail && detail !== message.toolTitle && diffs.length === 0) && !failed
  const hasBody =
    hasTextDetail ||
    diffs.length > 0 ||
    locations.length > 0 ||
    needsApproval ||
    Boolean(failureGuide) ||
    Boolean(failureExplain) ||
    Boolean(diagramPayload) ||
    Boolean(crossRefPayload) ||
    Boolean(auditPayload) ||
    Boolean(suggestionPayload)
  const title = message.toolTitle || '工具调用'
  const locationHint =
    diffs.length === 1
      ? basename(diffs[0]!.path)
      : locations.length === 1
        ? basename(locations[0]!.path)
        : locations.length > 1
          ? `${locations.length} 个文件`
          : diffs.length > 1
            ? `${diffs.length} 个文件`
            : null

  return (
    <AgentChatItem
      variant="card"
      tone={needsApproval ? 'tool-pending' : 'tool'}
      streaming={active}
      probe="tool"
      messageId={message.id}
      role="tool"
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {statusIcon(message.toolStatus, message.streaming || needsApproval)}
        <span className="text-muted-foreground">{kindIcon(message.toolKind)}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/90">
          {title}
          {locationHint ? (
            <span className="ml-1.5 font-normal text-muted-foreground">{locationHint}</span>
          ) : null}
          {failureExplain ? (
            <span className="ml-1.5 font-normal text-destructive/90">
              · {failureExplain.headline}
            </span>
          ) : null}
          {needsApproval ? (
            <span className="ml-1.5 font-normal text-amber-700 dark:text-amber-400">
              · 待批准
            </span>
          ) : null}
        </span>
        {hasBody ? (
          open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : null}
      </button>

      {open && hasBody ? (
        <AgentChatItemBody>
          {locations.length > 0 && diffs.length === 0 ? (
            <ul className="min-w-0 space-y-0.5">
              {locations.map((loc: AcpToolLocation) => (
                <li
                  key={`${loc.path}:${loc.line ?? ''}`}
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={loc.path}
                >
                  {basename(loc.path)}
                  {loc.line != null ? `:${loc.line}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {diffs.length > 0 ? <AgentDiffPreview diffs={diffs} /> : null}
          {failureExplain ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {failureExplain.body}
            </p>
          ) : null}
          {diagramPayload ? (
            <div className="mt-1">
              <DiagramViewerCard
                payload={diagramPayload}
                onHighlightAnchor={(anchor: string) => {
                  toast.message(`正在定位原文：「${anchor.slice(0, 24)}...」`)
                  window.dispatchEvent(
                    new CustomEvent('montree:anchor-highlight', { detail: anchor }),
                  )
                }}
                onPinToDoc={(p: DiagramPayload) => {
                  void navigator.clipboard.writeText(
                    `\n\n\`\`\`mermaid\n${p.mermaidCode}\n\`\`\`\n\n`,
                  )
                  toast.success('图表 Mermaid 源码已复制，可粘贴至正文或笔记')
                }}
              />
            </div>
          ) : null}
          {crossRefPayload ? (
            <div className="mt-1">
              <CrossReferenceCard
                payload={crossRefPayload}
                onNavigateChapter={(flatIndex, excerpt) => {
                  if (typeof flatIndex === 'number') {
                    void openChapterForMarkRecovery(flatIndex)
                  }
                  if (excerpt) {
                    window.dispatchEvent(
                      new CustomEvent('montree:anchor-highlight', { detail: excerpt }),
                    )
                  }
                }}
              />
            </div>
          ) : null}
          {auditPayload ? (
            <div className="mt-1">
              <ContentAuditCard
                payload={auditPayload}
                onHighlightAnchor={(anchor: string) => {
                  toast.message(`正在定位原句：「${anchor.slice(0, 24)}...」`)
                  window.dispatchEvent(
                    new CustomEvent('montree:anchor-highlight', { detail: anchor }),
                  )
                }}
              />
            </div>
          ) : null}
          {suggestionPayload ? (
            <div className="mt-1">
              <ChapterSuggestionCard
                payload={suggestionPayload}
                onSelectChapter={(item) => {
                  if (item.flatIndex != null) {
                    void openChapterForMarkRecovery(item.flatIndex)
                  }
                }}
              />
            </div>
          ) : null}
          {!diagramPayload && !crossRefPayload && !auditPayload && !suggestionPayload && hasTextDetail ? (
            <pre className={AGENT_CHAT_PRE_CLASS}>{detail}</pre>
          ) : null}
          {failureGuide ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {failureGuide.canOpenChapter ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => {
                    void openChapterForMarkRecovery(failureGuide.flatIndex)
                  }}
                >
                  打开该章
                </Button>
              ) : null}
              {failureGuide.canSelectText ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => promptSelectTextForMarkRecovery()}
                >
                  去划词
                </Button>
              ) : null}
            </div>
          ) : null}
          {needsApproval && pendingPermission ? (
            <AgentPermissionCard pending={pendingPermission} compact />
          ) : null}
        </AgentChatItemBody>
      ) : null}
    </AgentChatItem>
  )
}
