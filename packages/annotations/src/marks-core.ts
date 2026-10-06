import type {
  CreateReadingMarkPayload,
  ReadingAnchor,
  ReadingMark,
  UpdateReadingMarkPayload,
} from '@montree/contracts'

/**
 * 路径规范化（大小写语义与 service 历史行为一致）。
 * @param platform 显式传入调用方平台（如 service 侧 `process.platform`），core 自身不读 Node 全局。
 */
export function normalizeMarkFilePath(filePath: string, platform?: string): string {
  const trimmed = filePath.trim()
  if (platform === 'win32') {
    return trimmed.toLowerCase()
  }
  return trimmed
}

export function validateReadingAnchor(anchor: ReadingAnchor): string | null {
  if (anchor.format !== 'web') return null
  try {
    const url = new URL(anchor.url)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '在线文档 URL 无效'
    }
  } catch {
    return '在线文档 URL 无效'
  }
  return null
}

/** 空白收敛为空：`?.trim() || undefined` 语义逐字保留 */
export function normalizeOptionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

/**
 * 纯组装：调用方（service）负责提供 `id`（crypto randomUUID）与 `now`（Date.now），
 * core 不触碰 Node/Electron/IO。
 */
export function buildReadingMark(input: {
  id: string
  now: number
  payload: CreateReadingMarkPayload
}): ReadingMark {
  const { id, now, payload } = input
  return {
    id,
    filePath: payload.filePath.trim(),
    fileFingerprint: payload.fileFingerprint,
    kind: payload.kind,
    anchor: payload.anchor,
    label: normalizeOptionalText(payload.label),
    note: normalizeOptionalText(payload.note),
    excerpt: normalizeOptionalText(payload.excerpt),
    color: payload.color,
    category: payload.category,
    title: normalizeOptionalText(payload.title),
    aiSummary: normalizeOptionalText(payload.aiSummary),
    keyPoints: payload.keyPoints,
    tags: payload.tags,
    collapsed: payload.collapsed,
    diagramId: normalizeOptionalText(payload.diagramId),
    chapter: payload.chapter ?? undefined,
    createdAt: now,
    updatedAt: now,
  }
}

/** 更新语义逐字：字段回退 + 清空 note 时 kind 回退（note→highlight），其余不动 */
export function applyReadingMarkUpdate(
  current: ReadingMark,
  payload: UpdateReadingMarkPayload,
  now: number,
): ReadingMark {
  const next: ReadingMark = {
    ...current,
    kind: payload.kind ?? current.kind,
    label: payload.label !== undefined ? payload.label.trim() || undefined : current.label,
    note: payload.note !== undefined ? payload.note.trim() || undefined : current.note,
    color: payload.color ?? current.color,
    category: payload.category !== undefined ? payload.category : current.category,
    title: payload.title !== undefined ? payload.title.trim() || undefined : current.title,
    aiSummary: payload.aiSummary !== undefined ? payload.aiSummary.trim() || undefined : current.aiSummary,
    keyPoints: payload.keyPoints !== undefined ? payload.keyPoints : current.keyPoints,
    tags: payload.tags !== undefined ? payload.tags : current.tags,
    collapsed: payload.collapsed !== undefined ? payload.collapsed : current.collapsed,
    diagramId: payload.diagramId !== undefined ? payload.diagramId.trim() || undefined : current.diagramId,
    chapter: payload.chapter !== undefined ? (payload.chapter ?? undefined) : current.chapter,
    updatedAt: now,
  }
  if (payload.note !== undefined && !payload.note.trim() && payload.kind === undefined) {
    next.kind = next.kind === 'note' ? 'highlight' : next.kind
  }
  return next
}

/**
 * 删除语义逐字：过滤 + 合并墓碑；id 不存在返回 null（调用方转 FILE_NOT_FOUND）。
 */
export function applyReadingMarkDelete(
  marks: readonly ReadingMark[],
  tombstones: Record<string, number> | undefined,
  id: string,
  now: number,
): { marks: ReadingMark[]; tombstones: Record<string, number> } | null {
  const nextMarks = marks.filter((mark) => mark.id !== id)
  if (nextMarks.length === marks.length) {
    return null
  }
  return {
    marks: nextMarks,
    tombstones: {
      ...(tombstones ?? {}),
      [id]: now,
    },
  }
}
