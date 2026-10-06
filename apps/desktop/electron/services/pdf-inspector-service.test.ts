import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  classifyPdfDocument,
  extractPdfPagesMarkdown,
} from './pdf-inspector-service'

/** 手造单页文本 PDF（Helvetica 明文，避免二进制夹具） */
function buildMinimalTextPdf(lines: string[]): Buffer {
  const encoder = new TextEncoder()
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const content = lines
    .map((line, index) => `BT /F1 18 Tf 72 ${700 - index * 24} Td (${line}) Tj ET`)
    .join('\n')
  objects[3] = `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(encoder.encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefAt = encoder.encode(pdf).length
  pdf += `xref\n0 6\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`
  return Buffer.from(encoder.encode(pdf))
}

describe('pdf-inspector-service', () => {
  let dir = ''
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('缺失文件返回 FILE_NOT_FOUND', async () => {
    const result = await classifyPdfDocument(join(tmpdir(), 'montree-no-such.pdf'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FILE_NOT_FOUND')
  })

  it('单页文本 PDF 分类为 TextBased 且无待 OCR 页', async () => {
    dir = await mkdtemp(join(tmpdir(), 'montree-inspector-'))
    const filePath = join(dir, 'sample.pdf')
    await writeFile(filePath, buildMinimalTextPdf(['Hello Montree TOC', 'Second line body']))
    const result = await classifyPdfDocument(filePath)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.pdfType).toBe('TextBased')
    expect(result.value.pageCount).toBe(1)
    expect(result.value.pagesNeedingOcr).toEqual([])
  })

  it('按页抽取 Markdown（对外 1-indexed）', async () => {
    dir = dir || (await mkdtemp(join(tmpdir(), 'montree-inspector-')))
    const filePath = join(dir, 'sample.pdf')
    await writeFile(filePath, buildMinimalTextPdf(['Hello Montree TOC']))
    const result = await extractPdfPagesMarkdown(filePath, [1])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.pages).toHaveLength(1)
    expect(result.value.pages[0]?.page).toBe(1)
    expect(result.value.pages[0]?.markdown).toContain('Hello Montree TOC')
  })
})
