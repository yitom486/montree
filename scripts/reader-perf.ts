/**
 * 阅读器纯函数压测（无 Electron、无大夹具，可在 CI/本地直跑）：
 *   bun run scripts/reader-perf.ts
 *
 * 覆盖阶段 2.2/2.3 关心的两条热路径：
 * 1. PDF 虚拟窗口：3000 页文档逐页滚动，断言每步只挂载 buffer 窗口内 canvas，
 *    且整轮判定耗时有上限（窗口逻辑退化会立刻超时失败）。
 * 2. 批注归并吞吐：5000 量级双端归并耗时上限（同步链路热路径）。
 *
 * 阈值均为本地经验值（M 系列/Ryzen 级别桌面 CPU），仅作退化告警，非严谨 benchmark。
 * 真机大书翻页 FPS/内存仍需手工压测（见 .plan 阶段 2.4）。
 */
import { shouldRenderPdfPage, PDF_PAGE_RENDER_BUFFER } from '../apps/desktop/src/lib/reader/pdf/pdf-window'
import { mergeReadingMarks } from '@montree/annotations'
import type { ReadingMark } from '@montree/contracts'

const FAILURES: string[] = []

function check(name: string, ms: number, budgetMs: number, detail: string): void {
  const ok = ms < budgetMs
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${ms.toFixed(1)}ms（预算 ${budgetMs}ms） ${detail}`)
  if (!ok) FAILURES.push(name)
}

// 1. PDF 虚拟窗口：3000 页逐页滚动
{
  const numPages = 3000
  let maxActive = 0
  let minActiveFull = Number.POSITIVE_INFINITY
  const t0 = performance.now()
  for (let current = 1; current <= numPages; current++) {
    let active = 0
    for (let page = 1; page <= numPages; page++) {
      if (shouldRenderPdfPage(page, current, numPages)) active++
    }
    if (active > maxActive) maxActive = active
    // 中间页窗口应恒为 2*buffer+1，两端页递减
    const expected =
      current <= PDF_PAGE_RENDER_BUFFER || current > numPages - PDF_PAGE_RENDER_BUFFER
        ? -1 // 端页跳过精确断言，只统计
        : 2 * PDF_PAGE_RENDER_BUFFER + 1
    if (expected !== -1) {
      if (active !== expected) {
        FAILURES.push(`windowing: 第 ${current} 页挂载 ${active} 页，期望 ${expected}`)
        break
      }
      if (active < minActiveFull) minActiveFull = active
    }
  }
  const ms = performance.now() - t0
  check(
    'pdf-window-3000p',
    ms,
    2000,
    `buffer=±${PDF_PAGE_RENDER_BUFFER}，峰值挂载 ${maxActive} 页/3000 页`,
  )
}

// 2. 批注归并吞吐：5000 本地 + 5000 远端（2500 重叠）
{
  const makeMark = (id: number, updatedAt: number): ReadingMark => ({
    id: `mark-${id}`,
    filePath: 'book.pdf',
    fileFingerprint: 'fp-1',
    createdAt: updatedAt,
    updatedAt,
    kind: 'highlight',
    anchor: { format: 'pdf', page: (id % 300) + 1 },
    excerpt: `highlight ${id}`,
  })
  const local = Array.from({ length: 5000 }, (_, i) => makeMark(i, 1000 + i))
  const remote = Array.from({ length: 5000 }, (_, i) => makeMark(i + 2500, 2000 + i))

  const t0 = performance.now()
  const result = mergeReadingMarks({ marks: local }, { marks: remote })
  const ms = performance.now() - t0
  const expected = 7500 // 0..7499 并集
  if (result.merged.marks.length !== expected) {
    FAILURES.push(`merge: 并集 ${result.merged.marks.length} 条，期望 ${expected}`)
  }
  check('marks-merge-5k', ms, 2000, `并集 ${result.merged.marks.length} 条`)
}

if (FAILURES.length > 0) {
  console.error(`\n${FAILURES.length} 项未通过：`)
  for (const f of FAILURES) console.error(` - ${f}`)
  process.exit(1)
}
console.log('\n全部通过')
