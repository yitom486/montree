import { isOk, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { RosettaInspectContentResult } from '@montree/contracts'
import type { WorkspaceSearchMarkdownResult } from '@montree/contracts'
import {
  CONTENT_AUDIT_HIT_TEXT_BUDGET,
  CONTENT_AUDIT_RESPONSE_TEXT_BUDGET,
  normalizeContentAuditQuery,
  parseContentAuditLimit,
  resolveContentAuditMatchPosition,
  windowContentAuditText,
  type ContentAuditHit,
} from '@montree/contracts'
import { rosettaApi } from '@/api/rosetta-api'
import { fileApi } from '@/api/file-api'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { collectActiveDocument } from './collect-turn-context'
import { getReaderContentProvider, type ReaderUnitText } from './reader-content-registry'
import { inspectEditorBufferText } from './inspect-editor-buffer'
import { inspectEbookSections } from './inspect-ebook-sections'

/**
 * 内容审计快照解析（P0 库取证 + P2.1 编辑器内存 + P2.2 工作区 + P3.1 电子书，只读）。
 *
 * 指纹绑定：取已注册 provider 的 fileFingerprint，且必须与当前活动文档同文件；
 * Agent 不可自带指纹。有指纹走 book-index IPC（语义一字不动）；
 * 无指纹但活动文档是 markdown 时，检索 provider.getCurrentText() 即编辑器内存
 * （未保存修改可见），source='editor-buffer'，有工作区根再合并 workspace-file；
 * 无指纹但活动文档是 EPUB/MOBI 时，按章节单元内存取证，source='ebook-section'；
 * 其他（未入库 PDF / 在线文档 / 无 provider）一律抛错。
 * 由快照层转为工具错误（绝不返回空结果冒充）。
 */
export interface InspectIndexedContentDeps {
  getActivePath?: () => string
  getFingerprint?: () => string
  /** 无指纹时读编辑器内存；非 markdown/未绑定返回 null（调用方报不支持） */
  getBufferText?: () => Promise<string | null>
  /** P3.1 无指纹 EPUB/MOBI 章节迭代器；不适用返回 null（调用方继续分支） */
  getEbookUnits?: () => AsyncIterable<ReaderUnitText> | null
  /** P2.2 工作区根（文件树状态）；无文件夹返回 '' 则只做内存 */
  getWorkspaceRoot?: () => string
  /** P2.2 工作区检索；失败由调用方降级为纯内存结果 */
  searchWorkspace?: (
    root: string,
    query: string,
    excludePath: string,
  ) => Promise<Result<WorkspaceSearchMarkdownResult, AppError>>
  callInspect?: (
    fingerprint: string,
    query: string,
    limit: number | undefined,
  ) => Promise<Result<RosettaInspectContentResult, AppError>>
}

function defaultDeps(): Required<InspectIndexedContentDeps> {
  return {
    getActivePath: () => collectActiveDocument()?.path ?? '',
    getFingerprint: () => {
      const provider = getReaderContentProvider()
      if (!provider || provider.filePath !== (collectActiveDocument()?.path ?? '')) return ''
      return provider.fileFingerprint ?? ''
    },
    getBufferText: async () => {
      const provider = getReaderContentProvider()
      const active = collectActiveDocument()
      if (!provider || !active || provider.filePath !== active.path) return null
      // 只认 kind，不猜扩展名：EPUB 绝不进内存取证
      if (active.kind !== 'markdown') return null
      return (await provider.getCurrentText()) ?? ''
    },
    getEbookUnits: () => {
      const provider = getReaderContentProvider()
      const active = collectActiveDocument()
      if (!provider || !active || provider.filePath !== active.path) return null
      // 只认 kind：epub/mobi 才进章节取证；markdown 走 buffer，PDF/在线文档拒绝
      if (active.kind !== 'epub' && active.kind !== 'mobi') return null
      if (typeof provider.iterateUnits !== 'function') return null
      // 生成器惰性：调用本身不执行章节加载，迭代时才逐节读取
      return provider.iterateUnits()
    },
    getWorkspaceRoot: () => useAppSettingsStore.getState().lastWorkspaceRoot ?? '',
    searchWorkspace: (root, query, excludePath) =>
      fileApi.searchWorkspaceMarkdown({ workspaceRoot: root, query, excludePath }),
    callInspect: (fingerprint, query, limit) =>
      rosettaApi.inspectContent({ fingerprint, query, limit }),
  }
}

function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error('展示条数须为 1–10 的整数')
  }
  return raw
}

export async function inspectIndexedContentForAgent(
  rawQuery: unknown,
  rawLimit: unknown,
  deps?: InspectIndexedContentDeps,
): Promise<string> {
  const resolved = { ...defaultDeps(), ...deps }
  const query = typeof rawQuery === 'string' ? rawQuery : ''
  if (!query.trim()) throw new Error('审计需要非空的 query 参数')
  const limit = parseLimit(rawLimit)
  // 范围校验前置（与主进程同文案，指纹路径行为不变；且保证短词不读正文）
  const validQuery = normalizeContentAuditQuery(query)
  if (!validQuery) throw new Error('检索词至少需要 3 个字符')
  const validLimit = parseContentAuditLimit(rawLimit)
  if (!validLimit) throw new Error('展示条数须为 1–10 的整数')
  const activePath = resolved.getActivePath()
  if (!activePath) throw new Error('当前没有打开的文档')
  const fingerprint = resolved.getFingerprint()
  if (fingerprint) {
    const result = await resolved.callInspect(fingerprint, query, limit)
    if (!isOk(result)) throw new Error(result.error.message || '内容审计失败')
    return JSON.stringify(result.value, null, 2)
  }
  // P3.1：无指纹 + EPUB/MOBI → 章节单元内存取证（不读库、不读工作区）
  const ebookUnits = resolved.getEbookUnits()
  if (ebookUnits) {
    return JSON.stringify(await inspectEbookSections(ebookUnits, validQuery, validLimit), null, 2)
  }
  // P2.1：无指纹 + markdown 活动文档 → 检索编辑器内存
  const text = await resolved.getBufferText()
  if (text === null) throw new Error('当前文档不支持内容审计（仅已入库 PDF、当前 Markdown 或当前 EPUB/MOBI）')
  const bufferResult = inspectEditorBufferText(text, validQuery, validLimit)
  // P2.2：有工作区根则合并其他已保存 markdown（buffer 在前，workspace 在后）；
  // 无根或检索失败都降级为纯内存结果，永不整次失败
  const workspaceRoot = resolved.getWorkspaceRoot()
  if (!workspaceRoot) return JSON.stringify(bufferResult, null, 2)
  const workspaceResult = await resolved.searchWorkspace(workspaceRoot, validQuery, activePath)
  if (!isOk(workspaceResult)) return JSON.stringify(bufferResult, null, 2)
  const pending = workspaceResult.value.hits.slice(
    0,
    Math.max(0, validLimit - bufferResult.hits.length),
  )
  const usedChars = bufferResult.hits.reduce((sum, hit) => sum + hit.text.length, 0)
  const budgetEach =
    pending.length === 0
      ? CONTENT_AUDIT_HIT_TEXT_BUDGET
      : Math.min(
          CONTENT_AUDIT_HIT_TEXT_BUDGET,
          Math.max(200, Math.floor((CONTENT_AUDIT_RESPONSE_TEXT_BUDGET - usedChars) / pending.length)),
        )
  const workspaceHits: ContentAuditHit[] = pending.map((hit) => {
    const windowed = windowContentAuditText(hit.line, validQuery, budgetEach)
    return {
      source: 'workspace-file' as const,
      locator: { filePath: hit.filePath, lineStart: hit.lineStart },
      text: windowed.text,
      textTruncated: windowed.truncated,
      matchPosition: resolveContentAuditMatchPosition(windowed.text, validQuery),
    }
  })
  const hits = [...bufferResult.hits, ...workspaceHits]
  const total = bufferResult.total + workspaceResult.value.total
  return JSON.stringify(
    { query: validQuery, total, truncated: hits.length < total, limit: validLimit, hits },
    null,
    2,
  )
}
