import { describe, expect, it } from 'vitest'
import {
  ACP_SNAPSHOT_OCR_TIMEOUT_MS,
  ACP_SNAPSHOT_TIMEOUT_MS,
  resolveSnapshotTimeoutMs,
} from './montree-snapshot'

describe('montree-snapshot', () => {
  it('常规快照 5s，可能触发 OCR 的 120s', () => {
    expect(resolveSnapshotTimeoutMs('toc.json')).toBe(ACP_SNAPSHOT_TIMEOUT_MS)
    expect(resolveSnapshotTimeoutMs('viewport.txt')).toBe(ACP_SNAPSHOT_OCR_TIMEOUT_MS)
    expect(resolveSnapshotTimeoutMs('chapter.txt')).toBe(ACP_SNAPSHOT_OCR_TIMEOUT_MS)
    expect(resolveSnapshotTimeoutMs('chapter')).toBe(ACP_SNAPSHOT_OCR_TIMEOUT_MS)
    expect(resolveSnapshotTimeoutMs('search')).toBe(ACP_SNAPSHOT_OCR_TIMEOUT_MS)
  })
})
