import type { DatabaseSync } from 'node:sqlite'
import { canonicalAnchorKey, type ReadingAnchor } from '@montree/contracts'

/**
 * 存量 marks 行 anchor_key 回填（v7 新增列）。
 * SQL 做不了规范化分支，TS 单源口径（与写入侧 insertMarkRow 同一函数）：
 * 只碰 `anchor_key = ''` 的行，幂等；返回回填行数。
 * 由 openBookDb 在 migrate 之后调用（import-book 等直调 migrateBookDb 的
 * 链路不调——那些链路不读写 marks，下次 openBookDb 即补）。
 */
export function backfillAnchorKeys(db: DatabaseSync): number {
  const rows = db
    .prepare("SELECT id, anchor_json FROM marks WHERE anchor_key = ''")
    .all() as Array<{ id: string; anchor_json: string }>
  if (rows.length === 0) return 0
  const update = db.prepare('UPDATE marks SET anchor_key = ? WHERE id = ?')
  let filled = 0
  for (const row of rows) {
    let anchor: ReadingAnchor | null = null
    try {
      anchor = JSON.parse(row.anchor_json) as ReadingAnchor
    } catch {
      continue
    }
    if (!anchor || typeof anchor.format !== 'string') continue
    try {
      update.get(canonicalAnchorKey(anchor), row.id)
      filled += 1
    } catch {
      // 单行失败不阻断其余行；下次 open 再补
    }
  }
  return filled
}
