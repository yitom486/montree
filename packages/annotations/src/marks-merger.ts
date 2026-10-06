import type { ReadingMark } from '@montree/contracts'

export interface SyncMarksPayload {
  marks: ReadingMark[]
  tombstones?: Record<string, number> // markId -> deletedAt timestamp
}

export interface MarksMergeResult {
  merged: SyncMarksPayload
  addedCount: number
  updatedCount: number
  deletedCount: number
  /** 本轮被 TTL 回收的墓碑数（两端均无活标记且过期） */
  tombstonesPrunedCount: number
}

/** 墓碑默认 TTL：90 天。过期且两端均无活标记的墓碑可安全回收，避免索引无限膨胀。 */
export const DEFAULT_TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000

export interface MarksMergeOptions {
  /** 当前时间戳（毫秒），默认 Date.now；单测可注入 */
  now?: number
  /** 墓碑 TTL（毫秒），默认 90 天 */
  tombstoneTtlMs?: number
}

/**
 * 划线与批注双向智能合并（UUID 并集 + updatedAt 仲裁 + 墓碑软删除索引防复活）
 */
export function mergeReadingMarks(
  local: SyncMarksPayload,
  remote: SyncMarksPayload,
  options?: MarksMergeOptions,
): MarksMergeResult {
  // 1. 合并双方删除墓碑（保留最新的删除时间戳）
  const mergedTombstones: Record<string, number> = {
    ...(local.tombstones ?? {}),
  }
  for (const [id, remoteDeletedAt] of Object.entries(remote.tombstones ?? {})) {
    const localDeletedAt = mergedTombstones[id]
    if (!localDeletedAt || remoteDeletedAt > localDeletedAt) {
      mergedTombstones[id] = remoteDeletedAt
    }
  }

  // 2. 建立本地 marks 映射
  const localMap = new Map<string, ReadingMark>()
  for (const mark of local.marks) {
    localMap.set(mark.id, mark)
  }

  // 3. 建立远端 marks 映射
  const remoteMap = new Map<string, ReadingMark>()
  for (const mark of remote.marks) {
    remoteMap.set(mark.id, mark)
  }

  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()])
  const resultMap = new Map<string, ReadingMark>()
  let addedCount = 0
  let updatedCount = 0
  let deletedCount = 0

  for (const id of allIds) {
    const localMark = localMap.get(id)
    const remoteMark = remoteMap.get(id)
    const tombstoneTime = mergedTombstones[id]

    // 确定当前项最新版本
    let winner: ReadingMark
    let isFromRemote = false

    if (localMark && remoteMark) {
      if (remoteMark.updatedAt > localMark.updatedAt) {
        winner = remoteMark
        isFromRemote = true
        if (JSON.stringify(remoteMark) !== JSON.stringify(localMark)) {
          updatedCount += 1
        }
      } else {
        winner = localMark
      }
    } else if (remoteMark) {
      winner = remoteMark
      isFromRemote = true
      addedCount += 1
    } else {
      winner = localMark!
    }

    // 检查是否已被墓碑删除
    if (tombstoneTime && winner.updatedAt <= tombstoneTime) {
      // 已在某端删除且未在其后重新更新，忽略此项
      deletedCount += 1
      continue
    }

    // 若在删除时间戳之后更新过，说明用户重新创建/更新了该划线，从墓碑移出
    if (tombstoneTime && winner.updatedAt > tombstoneTime) {
      delete mergedTombstones[id]
    }

    resultMap.set(id, winner)
  }

  // 墓碑 GC：仅回收「过期且两端均无活标记」的墓碑。对端仍持有活标记时即使过期
  // 也保留——下次该标记复活为用户可见（可再删），优于静默丢数据。
  const now = options?.now ?? Date.now()
  const ttl = options?.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS
  let tombstonesPrunedCount = 0
  for (const [id, deletedAt] of Object.entries(mergedTombstones)) {
    if (!allIds.has(id) && now - deletedAt > ttl) {
      delete mergedTombstones[id]
      tombstonesPrunedCount += 1
    }
  }

  return {
    merged: {
      marks: Array.from(resultMap.values()),
      tombstones: mergedTombstones,
    },
    addedCount,
    updatedCount,
    deletedCount,
    tombstonesPrunedCount,
  }
}
