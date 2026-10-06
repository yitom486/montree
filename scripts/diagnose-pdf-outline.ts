/**
 * 诊断 PDF 嵌入书签（outline）解析情况。
 * Run: bun run scripts/diagnose-pdf-outline.ts [pdfPath]
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { loadPdfOutlineUnits } from '@montree/reader-core'

const pdfPath =
  process.argv[2] ?? 'D:/book/2027计算机组成原理_高清带书签版.pdf'

const root = path.resolve(import.meta.dir, '..')
const pdfjsRoot = path.join(root, 'node_modules/pdfjs-dist')
const { getDocument, GlobalWorkerOptions } = await import(
  pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.mjs')).href
)

GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(pdfjsRoot, 'legacy/build/pdf.worker.mjs'),
).href

const data = new Uint8Array(readFileSync(pdfPath))
const rawCopy = Buffer.from(data)
const task = getDocument({ data })
const pdf = await task.promise

console.log('PDF:', pdfPath)
console.log('numPages:', pdf.numPages)

const outline = (await pdf.getOutline()) as Array<{
  title: string
  dest: string | unknown[] | null
  url?: string | null
  items?: unknown[]
}> | null

const destinations = await pdf.getDestinations()
const pageLabels = await pdf.getPageLabels()
const metadata = await pdf.getMetadata().catch(() => null)

console.log('\n=== other navigation metadata ===')
console.log('namedDestinations:', destinations.size)
if (destinations.size > 0) {
  const entries = [...destinations.entries()].slice(0, 10)
  for (const [name, dest] of entries) {
    console.log(`  ${name}:`, JSON.stringify(dest))
  }
}
console.log('pageLabels:', pageLabels ? pageLabels.slice(0, 10) : null)
if (metadata?.info) {
  console.log('info.Title:', (metadata.info as { Title?: string }).Title)
  console.log('info.Subject:', (metadata.info as { Subject?: string }).Subject)
}

// 在原始字节里搜 PDF outline 相关关键字（有些畸形 PDF 字典键不在标准位置）
const raw = rawCopy
const markers = ['/Outlines', '/Outline', '/Dest', '/First', '/Last', '/Count', '/Title']
console.log('\n=== raw byte markers ===')
for (const m of markers) {
  let idx = 0
  let count = 0
  const needle = Buffer.from(m, 'latin1')
  while ((idx = raw.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  console.log(`  ${m}: ${count}`)
}

console.log('\n=== raw outline ===')
console.log('topLevelCount:', outline?.length ?? 0)

if (!outline?.length) {
  console.log('(no embedded outline via getOutline)')
}

type OutlineDiag = {
  title: string
  destType: string
  destPreview: string
  resolvedPage: number | null
  error?: string
  childCount: number
}

async function resolveDestToPage(dest: string | unknown[] | null): Promise<{
  page: number | null
  error?: string
  destPreview: string
}> {
  if (!dest) return { page: null, error: 'dest is null', destPreview: 'null' }

  const destPreview =
    typeof dest === 'string'
      ? `named:${dest}`
      : JSON.stringify(
          dest.map((part, i) => {
            if (i === 0 && part && typeof part === 'object') {
              const ref = part as { num?: number; gen?: number }
              if ('num' in ref) return `ref(${ref.num},${ref.gen ?? 0})`
            }
            return part
          }),
        )

  try {
    const explicitDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!explicitDest || !Array.isArray(explicitDest)) {
      return { page: null, error: 'explicitDest not array', destPreview }
    }
    const pageIndex = await pdf.getPageIndex(
      explicitDest[0] as Parameters<typeof pdf.getPageIndex>[0],
    )
    return { page: pageIndex + 1, destPreview }
  } catch (e) {
    return {
      page: null,
      error: e instanceof Error ? e.message : String(e),
      destPreview,
    }
  }
}

async function walkOutline(
  items: typeof outline,
  level = 0,
): Promise<OutlineDiag[]> {
  const rows: OutlineDiag[] = []
  for (const item of items ?? []) {
    const { page, error, destPreview } = await resolveDestToPage(item.dest ?? null)
    rows.push({
      title: item.title,
      destType: item.dest === null || item.dest === undefined ? 'null' : typeof item.dest,
      destPreview,
      resolvedPage: page,
      error,
      childCount: item.items?.length ?? 0,
    })
    if (item.items?.length) {
      rows.push(...(await walkOutline(item.items as typeof outline, level + 1)))
    }
  }
  return rows
}

const diag = outline?.length ? await walkOutline(outline) : []
const ok = diag.filter((r) => r.resolvedPage !== null)
const fail = diag.filter((r) => r.resolvedPage === null)

console.log('\n=== outline resolution ===')
console.log('totalItems:', diag.length)
console.log('resolved:', ok.length)
console.log('failed:', fail.length)

console.log('\n--- first 15 resolved ---')
for (const row of ok.slice(0, 15)) {
  console.log(`  p${row.resolvedPage}\t${row.title}`)
}

if (fail.length > 0) {
  console.log('\n--- failed items (up to 10) ---')
  for (const row of fail.slice(0, 10)) {
    console.log(`  "${row.title}"`)
    console.log(`    dest: ${row.destPreview}`)
    console.log(`    error: ${row.error ?? 'unknown'}`)
  }
}

const units = await loadPdfOutlineUnits(pdf)
console.log('\n=== loadPdfOutlineUnits ===')
console.log('unitCount:', units.length)
console.log('isPageFallback:', units.length === pdf.numPages && units[0]?.label === '第 1 页')
console.log('\n--- first 15 units ---')
for (const u of units.slice(0, 15)) {
  console.log(`  L${u.level}\tp${u.href}\t${u.label}`)
}

// 抽样：各页文本层
console.log('\n=== text layer sample (pages 1-8) ===')
for (let p = 1; p <= Math.min(8, pdf.numPages); p++) {
  const page = await pdf.getPage(p)
  const text = await page.getTextContent()
  const charCount = text.items.reduce((n, it) => n + ((it as { str?: string }).str?.length ?? 0), 0)
  console.log(`  page ${p}: items=${text.items.length} chars=${charCount}`)
}

await task.destroy()
