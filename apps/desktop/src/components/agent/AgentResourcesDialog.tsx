import { useMemo, useRef, useState } from 'react'
import { BookOpen, Copy, FolderOpen, Loader2, Plug, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { InspectedMcp, SkillDetail } from '../../../contracts/agent-inspection'
import { agentInspectionApi } from '@/api/agent-inspection-api'
import { appApi } from '@/api/app-api'
import { useAgentInspection, useAgentSkill, type AgentInspectionContext } from '@/hooks/agent/useAgentInspection'
import { renderAgentMarkdown } from '@/lib/agent/agent-markdown'
import { useCodeBlockCopy } from '@/hooks/preview/useCodeBlockCopy'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import '@/styles/markdown-preview.css'

const MCP_STATUS: Record<InspectedMcp['status'], string> = {
  connected: '已连接 · 已发现工具',
  discovered: '已发现工具 · 当前无活跃连接',
  waiting: '等待 Agent 发现工具',
  inactive: '当前会话未连接',
}
const CONNECTION_STATUS: Record<string, string> = {
  connected: '会话已连接',
  disconnected: '会话未连接',
  connecting: '正在连接',
  awaiting_auth: '等待认证',
  error: '连接异常',
}
const errorText = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
const dateText = (value: string | null) => value ? new Date(value).toLocaleString() : '尚无记录'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-1.5 text-xs"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words whitespace-pre-wrap">{children}</dd></div>
}

function McpDetail({ item }: { item: InspectedMcp }) {
  return <>
    <h3 className="text-base font-semibold">{item.name}</h3>
    <p className="mt-2 text-sm" role="status">{MCP_STATUS[item.status]}</p>
    <dl className="my-4 rounded-lg border bg-muted/20 px-3 py-2">
      <Fact label="传输方式">{item.transport}（本地桥接）</Fact>
      <Fact label="会话绑定">{item.attached ? '已提供给当前会话' : '尚未绑定当前会话'}</Fact>
      <Fact label="本地端点">{item.endpoint}</Fact>
      <Fact label="活跃客户端">{item.activeClients}</Fact>
      <Fact label="工具发现次数">{item.discoveries}</Fact>
      <Fact label="断开次数">{item.disconnects}</Fact>
      <Fact label="最近工具发现">{dateText(item.lastDiscoveredAt)}</Fact>
    </dl>
    <h4 className="mb-2 text-sm font-medium">提供的工具 · {item.tools.length}</h4>
    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">展开工具可查看用途和参数。工具发现表示客户端请求过工具列表；实际调用能力仍由 Agent 决定。</p>
    <div className="space-y-2">{item.tools.map((tool) => <details key={tool.name} className="rounded-lg border p-3">
      <summary className="cursor-pointer break-all font-mono text-xs focus-visible:outline-2 focus-visible:outline-ring">{tool.name}</summary>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{tool.description}</p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
    </details>)}</div>
  </>
}

function SkillBody({ skill, context }: { skill: SkillDetail; context: AgentInspectionContext }) {
  const [raw, setRaw] = useState(false)
  const [opening, setOpening] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useCodeBlockCopy(bodyRef, raw)
  const html = useMemo(() => renderAgentMarkdown(skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')), [skill.content])
  const usage = `请使用 ${skill.name} 技能完成以下任务：\n[在这里描述你的任务]`
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="min-w-0 break-words text-base font-semibold">{skill.name}</h3>
      <Button size="sm" variant="outline" disabled={opening} onClick={async () => {
        setOpening(true)
        try { await agentInspectionApi.reveal({ ...context, skillId: skill.id }) }
        catch (error) { toast.error(errorText(error)) }
        finally { setOpening(false) }
      }}><FolderOpen className="size-3.5" />打开文件位置</Button>
    </div>
    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{skill.description || '此技能没有提供简介，请查看下方完整说明。'}</p>
    <dl className="my-4 rounded-lg border bg-muted/20 px-3 py-2">
      <Fact label="来源">{skill.source}</Fact><Fact label="文件">{skill.path}</Fact>
      <Fact label="更新时间">{dateText(skill.modifiedAt)}</Fact><Fact label="文件大小">{(skill.bytes / 1024).toFixed(1)} KiB</Fact>
      <Fact label="发现状态">已发现本地文件</Fact><Fact label="加载 / 使用">Agent 未上报，无法确认</Fact>
    </dl>
    <div className="mb-5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">使用示例</h4>
        <Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(usage); toast.success('已复制使用示例') } catch { toast.error('复制失败') } }}><Copy className="size-3.5" />复制示例</Button>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{usage}</pre>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">在聊天中明确指定技能并描述任务。具体触发条件、步骤和限制以技能原文为准；此处不会修改 Agent 的技能配置。</p>
    </div>
    <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-sm font-medium">完整技能说明</h4>
      <Button size="sm" variant="outline" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? '阅读模式' : '查看原文'}</Button>
    </div>
    {raw ? <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-relaxed">{skill.content}</pre> : <div
      ref={bodyRef}
      className="markdown-preview min-w-0 break-words text-sm [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_pre]:overflow-x-auto [&_pre]:text-xs [&_table]:block [&_table]:overflow-x-auto"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a')
        if (!link) return
        event.preventDefault()
        if (/^https?:\/\//i.test(link.href)) void appApi.openExternal(link.href).then((result) => { if (!result.ok) toast.error(result.error.message) }).catch(() => toast.error('无法打开链接'))
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />}
  </>
}

export function AgentResourcesDialog({ context, kind, onClose }: { context: AgentInspectionContext; kind: 'mcp' | 'skills' | null; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const inspection = useAgentInspection(context, kind)
  const data = inspection.data
  const items = kind === 'mcp' ? data?.mcps ?? [] : data?.skills ?? []
  const filtered = items.filter((item) => `${item.name} ${'description' in item ? item.description : ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]
  const detail = useAgentSkill(context, kind === 'skills' ? selected?.id ?? null : null)
  // 轮询/刷新失败时不要用错误页覆盖上一次成功结果，否则 3 秒一次的瞬时失败会让面板闪成空白。
  const inspectionFailed = inspection.isError && !data
  const detailFailed = detail.isError && !detail.data
  const title = kind === 'mcp' ? 'MCP 连接详情' : 'Skills 技能详情'
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await inspection.refetch()
      if (kind === 'skills' && selected) await detail.refetch()
    } finally {
      setRefreshing(false)
    }
  }
  return <Dialog open={kind !== null} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="flex h-[min(760px,calc(100dvh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]" onCloseAutoFocus={(event) => {
      // 菜单项会在选中后卸载，将焦点还给本面板的菜单按钮。
      const buttons = document.querySelectorAll<HTMLButtonElement>('aside[aria-label="Agent 聊天"] button[aria-label="更多面板操作"]')
      const button = [...buttons].find((node) => node.getClientRects().length)
      if (button) { event.preventDefault(); button.focus() }
    }}>
      <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
        <DialogTitle className="flex items-center gap-2">{kind === 'mcp' ? <Plug className="size-4 text-primary" /> : <BookOpen className="size-4 text-primary" />}{title}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{data?.agentName ?? context.runtimeId}{data?.agentVersion ? ` · ${data.agentVersion}` : ''} · {data ? CONNECTION_STATUS[data.connectionStatus] ?? data.connectionStatus : '正在读取会话状态'}{kind === 'mcp' ? ' · 每 3 秒刷新连接状态' : ' · 本地技能目录'}</DialogDescription>
      </DialogHeader>
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={kind === 'mcp' ? '搜索 MCP' : '搜索 Skills'} placeholder={kind === 'mcp' ? '搜索 MCP…' : '搜索名称或简介…'} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />刷新</Button>
      </div>
      {inspection.isPending ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />正在读取…</div> : inspectionFailed ? <div role="alert" className="flex-1 overflow-auto p-5 text-sm text-destructive">{errorText(inspection.error)}<p className="mt-2 text-muted-foreground">可关闭弹窗后重新打开，或点击刷新。</p></div> : <div className="grid min-h-0 flex-1 grid-rows-[minmax(80px,25%)_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1">
        <nav aria-label={kind === 'mcp' ? 'MCP 列表' : 'Skills 列表'} className="overflow-y-auto border-b p-2 md:border-r md:border-b-0">
          <p className="px-3 py-2 text-xs text-muted-foreground">{filtered.length} / {items.length} 项</p>
          {!filtered.length ? <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">{search ? '没有匹配的项目' : kind === 'mcp' ? '尚无 MCP 服务，请连接会话后刷新。' : '已知目录中未发现 SKILL.md 文件。'}</p> : <ul className="space-y-1">{filtered.map((item) => <li key={item.id}><button type="button" aria-pressed={selected?.id === item.id} aria-controls="agent-resource-detail" onClick={() => setSelectedId(item.id)} className={cn('w-full rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring', selected?.id === item.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
            <span className="block break-words text-sm font-medium">{item.name}</span><span className="mt-1 block break-words text-[11px] leading-relaxed text-muted-foreground">{'status' in item ? MCP_STATUS[item.status] : item.source}</span>
          </button></li>)}</ul>}
        </nav>
        <section id="agent-resource-detail" aria-label="资源详情" className="min-w-0 overflow-auto p-5">
          {!selected ? <p className="text-sm text-muted-foreground">选择列表中的项目以查看详情。</p> : kind === 'mcp' ? <McpDetail item={selected as InspectedMcp} /> : detail.isPending ? <p role="status" className="text-sm text-muted-foreground">正在读取完整说明…</p> : detailFailed ? <p role="alert" className="text-sm text-destructive">{errorText(detail.error)}</p> : detail.data ? <>{detail.isError ? <p role="status" className="mb-3 text-xs text-destructive">刷新失败，显示上次读取的内容：{errorText(detail.error)}</p> : null}<SkillBody key={detail.data.id} skill={detail.data} context={context} /></> : null}
        </section>
      </div>}
      <div className="max-h-36 shrink-0 overflow-auto border-t bg-muted/20 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <p>{kind === 'mcp' ? data?.mcpCoverage : data?.skillsCoverage}</p>
        <p className="mt-1 break-all">会话：{data?.sessionId ?? '尚未创建'}{data?.workspace ? ` · 工作区：${data.workspace}` : ''}</p>
        {inspection.isError && data ? <p className="mt-1 text-destructive">刷新失败，显示上次结果：{errorText(inspection.error)}</p> : null}
        {kind === 'mcp' && data && <p className="mt-1">最近检查：{dateText(data.observedAt)}</p>}
        {!!data?.warnings.length && <details className="mt-1"><summary className="cursor-pointer">{data.warnings.length} 条读取提示</summary><ul className="mt-1 space-y-1">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}
      </div>
    </DialogContent>
  </Dialog>
}
