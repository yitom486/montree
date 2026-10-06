import { useReaderNavigationStore } from '@/stores/reader-navigation-store'
import {
  getReaderContentProvider,
  normalizeReaderText,
  READER_TEXT_MAX_CHARS,
  type ReaderUnitText,
} from './reader-content-registry'

export interface ReadChapterArgs {
  /** 目录 flatIndex（与 montree_get_toc.entries[].index 一致） */
  flatIndex?: number
  /** 章节标题；可与 flatIndex 二选一，精确匹配优先，其次包含匹配 */
  title?: string
}

export interface ReadChapterResult {
  index: number
  label: string
  text: string
  /** 标题解析方式 */
  matchedBy: 'flatIndex' | 'title-exact' | 'title-includes'
}

function resolveUnitIndex(
  units: readonly { label: string }[],
  args: ReadChapterArgs,
): { index: number; matchedBy: ReadChapterResult['matchedBy'] } {
  if (typeof args.flatIndex === 'number' && Number.isFinite(args.flatIndex)) {
    const index = Math.trunc(args.flatIndex)
    if (index < 0 || index >= units.length) {
      throw new Error(`flatIndex 越界：有效范围 0..${Math.max(0, units.length - 1)}，收到 ${index}`)
    }
    return { index, matchedBy: 'flatIndex' }
  }

  const title = args.title?.trim()
  if (!title) {
    throw new Error('请提供 flatIndex 或 title（与目录条目对应）')
  }

  const lower = title.toLowerCase()
  const exact = units.findIndex((unit) => unit.label.trim().toLowerCase() === lower)
  if (exact >= 0) return { index: exact, matchedBy: 'title-exact' }

  const partial = units.findIndex((unit) => unit.label.toLowerCase().includes(lower))
  if (partial >= 0) return { index: partial, matchedBy: 'title-includes' }

  throw new Error(`目录中找不到标题含「${title}」的条目，可先用 montree_read(scope=toc) 核对`)
}

/**
 * 按目录 flatIndex 或标题取某一章/页正文（不跳转阅读位置）。
 * 优先走 provider.getUnitByIndex；否则用 iterateUnits 按 label 匹配。
 */
export async function readChapterByRef(args: ReadChapterArgs): Promise<ReadChapterResult> {
  const provider = getReaderContentProvider()
  if (!provider) {
    throw new Error('当前没有打开的文档，或该格式暂不支持提取正文')
  }

  const reader = useReaderNavigationStore.getState()
  if (!reader.ready || reader.units.length === 0) {
    throw new Error('目录尚未就绪，请稍后再试或先调用 montree_read(scope=toc)')
  }

  const { index, matchedBy } = resolveUnitIndex(reader.units, args)
  const label = reader.units[index]!.label

  let unit: ReaderUnitText | null = null
  if (provider.getUnitByIndex) {
    unit = await provider.getUnitByIndex(index)
  } else if (provider.iterateUnits) {
    for await (const item of provider.iterateUnits()) {
      if (item.label === label || item.label.toLowerCase() === label.toLowerCase()) {
        unit = item
        break
      }
    }
  } else {
    throw new Error('当前文档格式暂不支持按章节读取')
  }

  if (!unit?.text.trim()) {
    throw new Error(`未能读取「${label}」（index=${index}）的正文`)
  }

  return {
    index,
    label: unit.label || label,
    text: normalizeReaderText(unit.text, READER_TEXT_MAX_CHARS),
    matchedBy,
  }
}
