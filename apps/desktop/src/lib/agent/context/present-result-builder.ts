import {
  COMPONENT_UI_MAX_BYTES,
  PRESENT_COMPARE_MAX_CHAPTERS,
  PRESENT_COMPARE_MAX_ITEMS,
  PRESENT_COMPARE_MIN_CHAPTERS,
  PRESENT_MAX_HTML_BYTES,
  PRESENT_MAX_TITLE_CHARS,
  collectEvidenceRefs,
  collectSelectIds,
  parsePresentResult,
  presentResultId,
  presentResultSizeError,
  presentUtf8Bytes,
  validateComponentUiSpec,
  type ComponentUiSpec,
  type MontreePresentResult,
  type PresentChapterRef,
  type PresentComparisonItem,
} from '@montree/contracts'
import { useActiveDocumentStore } from '@/stores/active-document-store'
import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import { getReaderContentProvider, type ReaderContentProvider } from './reader-content-registry'

function fail(message: string): never {
  throw new Error(message)
}

function requiredTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > PRESENT_MAX_TITLE_CHARS) {
    fail(`title 须为 1–${PRESENT_MAX_TITLE_CHARS} 字非空文本`)
  }
  return (value as string).trim()
}

function optionalSummary(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, 2000)
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 宿主剥离模型提供的 base 与全部 meta（含 CSP/refresh）：宿主策略唯一生效，不允许覆盖 */
export function stripHostileHtmlHead(html: string): string {
  return html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
}

interface ResolvedChapter {
  key: string
  label: string
  index: number
  text: string
}

interface PinnedSource {
  provider: ReaderContentProvider
  filePath: string
  label: string
  units: Array<{ label: string; level?: number; href?: string }>
  labels: string[]
}

/**
 * 目录读取唯一规则（捕获与校验共用）：provider 自带 getUnits 优先，
 * 否则回退“同 filePath 且 ready”的导航 store。两处不一致即目录分支遗漏。
 */
function readDirectorySnapshot(
  provider: ReaderContentProvider,
): { units: Array<{ label: string; level?: number; href?: string }>; labels: string[] } | null {
  const fromProvider = provider.getUnits?.()
  if (fromProvider) {
    return { units: fromProvider, labels: fromProvider.map((u) => u.label) }
  }
  const nav = useReaderNavigationStore.getState()
  if (nav.filePath === provider.filePath && nav.ready) {
    return { units: nav.units, labels: nav.units.map((u) => u.label) }
  }
  return null
}

function sameDirectory(a: PinnedSource['units'], b: PinnedSource['units']): boolean {
  return a.length === b.length && a.every((unit, i) => unit.label === b[i]?.label && unit.level === b[i]?.level && unit.href === b[i]?.href)
}

/**
 * U0：调用开始即固定来源（provider 对象身份 + 文件指纹 + 目录快照）。
 * filePath 只作展示与辅助定位，会话身份以 provider 对象为准：
 * 同路径重注册、A→B→A 都是新对象，旧任务一律拒绝。
 */
function pinComparisonSource(): PinnedSource {
  const provider = getReaderContentProvider()
  const filePath = provider?.filePath ?? useActiveDocumentStore.getState().filePath
  if (!filePath?.trim()) fail('无法确定来源文档：请先打开文档后再调用呈现工具')
  if (!provider) fail('当前没有打开的文档，或该格式暂不支持提取正文')
  const snapshot = readDirectorySnapshot(provider)
  if (!snapshot || snapshot.units.length === 0) {
    fail('目录尚未就绪，请稍后再试或先调用 montree_read(scope=toc)')
  }
  const clean = filePath.trim()
  return {
    provider,
    filePath: clean,
    label: clean.replace(/\\/g, '/').split('/').pop() || clean,
    units: snapshot.units.map((u) => ({ label: u.label, ...(u.level !== undefined ? { level: u.level } : {}), ...(u.href ? { href: u.href } : {}) })),
    labels: snapshot.labels,
  }
}

/**
 * 每次 await 后及序列化前调用：provider 对象切换、目录未就绪或目录变化
 * 即明确拒绝，不生成混合两份文档摘录却绑定一处的结果。
 */
function assertSameSource(pinned: PinnedSource, stage: string): void {
  const current = getReaderContentProvider()
  if (!current || current !== pinned.provider) {
    fail(`文档在${stage}发生了切换（来源：${pinned.label}），已拒绝生成混合来源的比较结果，请重新调用`)
  }
  const latest = readDirectorySnapshot(current)
  if (!latest || latest.units.length === 0) {
    fail(`文档目录在${stage}尚未就绪（来源：${pinned.label}），已拒绝生成旧快照的比较结果，请稍后重试`)
  }
  if (!sameDirectory(latest.units, pinned.units)) {
    fail(`文档目录在${stage}发生了变化（来源：${pinned.label}），已拒绝生成混合来源的比较结果，请重新调用`)
  }
}

/**
 * 固定快照内的目录解析（与 readChapterByRef 同语义/同文案，不读全局当前文档）。
 * readChapterByRef 保持原行为供其他调用方使用，这里只为比较卡固定来源。
 */
function resolvePinnedUnitIndex(
  units: PinnedSource['units'],
  args: { flatIndex?: number; title?: string },
): number {
  if (typeof args.flatIndex === 'number' && Number.isFinite(args.flatIndex)) {
    const index = Math.trunc(args.flatIndex)
    if (index < 0 || index >= units.length) {
      throw new Error(`flatIndex 越界：有效范围 0..${Math.max(0, units.length - 1)}，收到 ${index}`)
    }
    return index
  }
  const title = args.title?.trim()
  if (!title) {
    throw new Error('请提供 flatIndex 或 title（与目录条目对应）')
  }
  const lower = title.toLowerCase()
  const exact = units.findIndex((unit) => unit.label.trim().toLowerCase() === lower)
  if (exact >= 0) return exact
  const partial = units.findIndex((unit) => unit.label.toLowerCase().includes(lower))
  if (partial >= 0) return partial
  throw new Error(`目录中找不到标题含「${title}」的条目，可先用 montree_read(scope=toc) 核对`)
}

async function resolveChapterPinned(
  pinned: PinnedSource,
  row: unknown,
  position: number,
): Promise<ResolvedChapter> {
  if (!row || typeof row !== 'object') fail(`chapters[${position}] 须为对象`)
  const item = row as Record<string, unknown>
  const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim().slice(0, 120) : fail(`chapters[${position}].key 须为非空文本`)
  const flatIndex = typeof item.flatIndex === 'number' ? item.flatIndex : undefined
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : undefined
  const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : (title ?? key)
  let index: number
  try {
    index = resolvePinnedUnitIndex(pinned.units, { flatIndex, title })
  } catch (error) {
    fail(`章节「${label}」无法对应到目录：${error instanceof Error ? error.message : String(error)}`)
  }
  const unitLabel = pinned.units[index]!.label
  let text: string | null = null
  let resolvedLabel = unitLabel
  try {
    if (pinned.provider.getUnitByIndex) {
      const unit = await pinned.provider.getUnitByIndex(index)
      assertSameSource(pinned, `读取第 ${position + 1} 章后`)
      if (unit) {
        text = unit.text
        resolvedLabel = unit.label || unitLabel
      }
    } else if (pinned.provider.iterateUnits) {
      for await (const entry of pinned.provider.iterateUnits()) {
        assertSameSource(pinned, `读取第 ${position + 1} 章后`)
        if (entry.label === unitLabel || entry.label.toLowerCase() === unitLabel.toLowerCase()) {
          text = entry.text
          resolvedLabel = entry.label || unitLabel
          break
        }
      }
      assertSameSource(pinned, `读取第 ${position + 1} 章后`)
    } else {
      fail('当前文档格式暂不支持按章节读取')
    }
  } catch (error) {
    // 来源切换拒绝直接透出（文案含“切换/来源”，调用方与测试据此识别）；其余读错包成目录对应失败
    if (error instanceof Error && /切换|混合来源/.test(error.message)) throw error
    fail(`章节「${label}」无法对应到目录：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!text?.trim()) {
    fail(`章节「${label}」无法对应到目录：未能读取「${unitLabel}」（index=${index}）的正文`)
  }
  return { key, label: resolvedLabel || label, index, text: text! }
}

function verifyExcerpt(chapterText: string, excerpt: string): boolean {
  const needle = excerpt.trim()
  if (!needle) return false
  if (chapterText.includes(needle)) return true
  return collapseWhitespace(chapterText).includes(collapseWhitespace(needle))
}

async function buildComparison(args: Record<string, unknown>, title: string): Promise<string> {
  const rawChapters = args.chapters
  if (!Array.isArray(rawChapters)) fail('chapter-comparison 需要 chapters 数组（2–6 章）')
  if (rawChapters.length < PRESENT_COMPARE_MIN_CHAPTERS || rawChapters.length > PRESENT_COMPARE_MAX_CHAPTERS) {
    fail(`chapters 须 ${PRESENT_COMPARE_MIN_CHAPTERS}–${PRESENT_COMPARE_MAX_CHAPTERS} 章，收到 ${rawChapters.length}`)
  }
  const chapters: ResolvedChapter[] = []
  const keys = new Set<string>()
  // P1：先固定来源，再逐章读取；每次 await 后校验未切换
  const pinned = pinComparisonSource()
  for (let i = 0; i < rawChapters.length; i += 1) {
    const resolved = await resolveChapterPinned(pinned, rawChapters[i], i)
    if (keys.has(resolved.key)) fail(`chapters[${i}].key 重复：${resolved.key}`)
    keys.add(resolved.key)
    chapters.push(resolved)
  }
  const byKey = new Map(chapters.map((c) => [c.key, c]))

  const rawItems = args.items ?? []
  if (!Array.isArray(rawItems)) fail('items 须为数组')
  if (rawItems.length > PRESENT_COMPARE_MAX_ITEMS) fail(`items 最多 ${PRESENT_COMPARE_MAX_ITEMS} 条，收到 ${rawItems.length}`)
  const items: PresentComparisonItem[] = []
  const seenIds = new Set<string>()
  rawItems.forEach((row, i) => {
    if (!row || typeof row !== 'object') fail(`items[${i}] 须为对象`)
    const item = row as Record<string, unknown>
    const dimension = typeof item.dimension === 'string' && item.dimension.trim() ? item.dimension.trim().slice(0, 200) : fail(`items[${i}].dimension 须为非空文本`)
    const chapterKey = typeof item.chapterKey === 'string' ? item.chapterKey : ''
    const chapter = byKey.get(chapterKey) ?? fail(`items[${i}].chapterKey 未在 chapters 中声明：${chapterKey}`)
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 120) : `item-${i}`
    if (seenIds.has(id)) fail(`items[${i}].id 重复：${id}`)
    seenIds.add(id)
    const excerpt = typeof item.excerpt === 'string' && item.excerpt.trim() ? item.excerpt.trim().slice(0, 2000) : undefined
    const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim().slice(0, 2000) : undefined
    const verified = excerpt !== undefined && verifyExcerpt(chapter!.text, excerpt)
    items.push({
      id,
      dimension,
      chapterKey,
      ...(excerpt !== undefined ? { excerpt } : {}),
      ...(note !== undefined ? { note } : {}),
      verified,
      ...(verified ? { flatIndex: chapter!.index } : {}),
    })
  })

  const summary = optionalSummary(args.summary)
  // P1：序列化前复核归属；指纹取调用开始固定的来源，不重取当前文档
  assertSameSource(pinned, '序列化前')
  const fingerprint = pinned.filePath
  const documentLabel = pinned.label
  const result: MontreePresentResult = {
    schemaVersion: 1,
    kind: 'chapter-comparison',
    id: presentResultId(
      'chapter-comparison',
      JSON.stringify({
        fingerprint,
        title,
        chapters: chapters.map((c) => [c.key, c.label, c.index]),
        items: items.map((item) => [item.dimension, item.chapterKey, item.excerpt ?? '', item.note ?? '']),
      }),
    ),
    title,
    ...(summary !== undefined ? { summary } : {}),
    documentFingerprint: fingerprint,
    documentLabel,
    chapters: chapters.map((c) => ({ key: c.key, label: c.label, flatIndex: c.index })),
    items,
  }
  return finalizePresentResult(result)
}

function buildArtifact(args: Record<string, unknown>, title: string): string {
  const html = args.html
  if (typeof html !== 'string' || !html.trim()) fail('html-artifact 需要非空 html 源码')
  if (presentUtf8Bytes(html) > PRESENT_MAX_HTML_BYTES) {
    fail(`html 源码超过 ${PRESENT_MAX_HTML_BYTES / 1024}KiB 上限，请精简后重试`)
  }
  const cleaned = stripHostileHtmlHead(html)
  const summary = optionalSummary(args.summary)
  const bound = optionalArtifactFingerprint()
  const result: MontreePresentResult = {
    schemaVersion: 1,
    kind: 'html-artifact',
    id: presentResultId('html-artifact', `${bound.fingerprint ?? ''}${title}${cleaned}${args.inline === true ? '|inline' : ''}`),
    title,
    ...(summary !== undefined ? { summary } : {}),
    ...(bound.fingerprint !== undefined ? { documentFingerprint: bound.fingerprint } : {}),
    ...(bound.label !== undefined ? { documentLabel: bound.label } : {}),
    html: cleaned,
    ...(args.inline === true ? { inline: true } : {}),
  }
  return finalizePresentResult(result)
}

function buildComponentUi(args: Record<string, unknown>, title: string): Promise<string> {
  const rawChapters = args.chapters
  if (!Array.isArray(rawChapters)) fail('component-ui 需要 chapters 数组（1–6 章，先读后呈）')
  if (rawChapters.length < 1 || rawChapters.length > PRESENT_COMPARE_MAX_CHAPTERS) {
    fail(`chapters 须 1–${PRESENT_COMPARE_MAX_CHAPTERS} 章，收到 ${rawChapters.length}`)
  }
  const pinned = pinComparisonSource()
  return (async () => {
    const chapters: ResolvedChapter[] = []
    const keys = new Set<string>()
    for (let i = 0; i < rawChapters.length; i += 1) {
      const resolved = await resolveChapterPinned(pinned, rawChapters[i], i)
      if (keys.has(resolved.key)) fail(`chapters[${i}].key 重复：${resolved.key}`)
      keys.add(resolved.key)
      chapters.push(resolved)
    }
    const byKey = new Map(chapters.map((c) => [c.key, c]))
    const ui = args.ui
    if (!ui || typeof ui !== 'object') fail('component-ui 需要 ui 树（含 root，仅白名单组件）')
    if (presentUtf8Bytes(JSON.stringify(ui)) > COMPONENT_UI_MAX_BYTES) {
      fail(`ui 树超过 ${COMPONENT_UI_MAX_BYTES / 1024}KiB 上限，请精简后重试`)
    }
    const treeError = validateComponentUiSpec(ui)
    if (treeError) fail(`ui 树校验未通过：${treeError}`)
    const { ids, error: selectError } = collectSelectIds((ui as { root?: unknown }).root)
    if (selectError) fail(`ui 树校验未通过：${selectError}`)
    if (ids.length === 0) fail('ui 树须含至少一个 Select（可提交的选择），纯展示请用 chapter-comparison')
    // Evidence 摘录逐条验原文：失败保留但剥离定位（verified=false），不伪造章号/位置
    const refs = collectEvidenceRefs((ui as { root?: unknown }).root)
    for (const ref of refs) {
      const chapter = byKey.get(ref.chapterKey)
      if (!chapter) fail(`Evidence.chapterKey 未在 chapters 中声明：${ref.chapterKey}`)
      if (!verifyExcerpt(chapter.text, ref.excerpt)) {
        fail(`Evidence 摘录须是「${chapter.label}」原文（未验证通过），请先用 montree_read 读取后再填`)
      }
    }
    assertSameSource(pinned, '序列化前')
    const summary = optionalSummary(args.summary)
    const submitLabel = typeof args.submitLabel === 'string' && args.submitLabel.trim()
      ? args.submitLabel.trim().slice(0, 200)
      : undefined
    const fingerprint = pinned.filePath
    const documentLabel = pinned.label
    const result: MontreePresentResult = {
      schemaVersion: 1,
      kind: 'component-ui',
      id: presentResultId(
        'component-ui',
        JSON.stringify({
          fingerprint,
          title,
          chapters: chapters.map((c) => [c.key, c.label, c.index]),
          ui,
        }),
      ),
      title,
      ...(summary !== undefined ? { summary } : {}),
      documentFingerprint: fingerprint,
      documentLabel,
      chapters: chapters.map(
        (c): PresentChapterRef => ({ key: c.key, label: c.label, flatIndex: c.index }),
      ),
      ui: ui as ComponentUiSpec,
      ...(submitLabel !== undefined ? { submitLabel } : {}),
    }
    return finalizePresentResult(result)
  })()
}

function finalizePresentResult(result: MontreePresentResult): string {
  const parsed = parsePresentResult(result)
  if (!parsed) throw new Error('呈现结果自检失败（内部错误，请重试或精简输入）')
  const sizeError = presentResultSizeError(parsed)
  if (sizeError) throw new Error(sizeError)
  return JSON.stringify(parsed)
}

/** 来源文档归属：优先实际读取的 provider 路径，回退当前活动文档 */
function resolveDocumentFingerprint(): { fingerprint: string; label: string } | null {
  const filePath =
    getReaderContentProvider()?.filePath ?? useActiveDocumentStore.getState().filePath
  if (!filePath?.trim()) return null
  const fingerprint = filePath.trim()
  const label = fingerprint.replace(/\\/g, '/').split('/').pop() || fingerprint
  return { fingerprint, label }
}

/** Artifact 无需文档：有则绑定，无则缺省（定位不适用） */
function optionalArtifactFingerprint(): { fingerprint?: string; label?: string } {
  const resolved = resolveDocumentFingerprint()
  if (!resolved) return {}
  return { fingerprint: resolved.fingerprint, label: resolved.label }
}

/**
 * `present` 快照资源实现：校验参数、验证章节归属、组装版本化结果信封。
 * 只做展示声明，不写文件、不改文档；非法输入抛中文 Error（主进程包成 isError）。
 */
export async function buildPresentResult(args: Record<string, unknown>): Promise<string> {
  if (args.kind === 'preset') {
    const { expandPresentPreset } = await import('./present-presets')
    return buildPresentResult(expandPresentPreset(args))
  }
  const kind = args.kind
  const title = requiredTitle(args.title)
  if (kind === 'chapter-comparison') return buildComparison(args, title)
  if (kind === 'html-artifact') return buildArtifact(args, title)
  if (kind === 'component-ui') return buildComponentUi(args, title)
  if (kind === 'react-artifact') {
    const bound = optionalArtifactFingerprint()
    const result = parsePresentResult({ schemaVersion: 1, kind, title, source: args.source, css: args.css,
      id: presentResultId(kind, JSON.stringify([bound.fingerprint, title, args.source, args.css])),
      summary: optionalSummary(args.summary), documentFingerprint: bound.fingerprint, documentLabel: bound.label })
    if (!result || result.kind !== 'react-artifact') fail('React 源码须非空且 ≤96KiB，CSS ≤16KiB')
    const { compileReactArtifact } = await import('@/api/react-artifact-api')
    const compiled = await compileReactArtifact(result.source, result.css)
    if (!compiled.ok) fail(`React 编译失败：${compiled.error.message}`)
    return finalizePresentResult(result)
  }
  fail('kind 须为 preset、chapter-comparison、html-artifact、component-ui 或 react-artifact')
}
