import { describe, expect, it } from 'vitest'
import { copyPdfBytesForPdfJs } from '@montree/ocr-core'
import { readPdfPageSizes } from './pdf-page-geometry'

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
    '4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello World) Tj ET\nendstream\nendobj\n' +
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    'trailer\n<< /Root 1 0 R >>\n',
  'latin1',
)

describe('readPdfPageSizes', () => {
  it('真实 MediaBox 尺寸（非写死 612×792：读出来必须对上）', async () => {
    const sizes = await readPdfPageSizes(MINIMAL_PDF, [1])
    expect(sizes.get(1)).toEqual({ width: 612, height: 792 })
  })

  it('越界页跳过', async () => {
    const sizes = await readPdfPageSizes(MINIMAL_PDF, [1, 99])
    expect(sizes.has(99)).toBe(false)
    expect(sizes.get(1)).toEqual({ width: 612, height: 792 })
  })

  it('非法数据返回空表（不抛错，调用方按页停手）', async () => {
    await expect(readPdfPageSizes(Buffer.from('not-a-pdf'), [1])).resolves.toEqual(new Map())
    await expect(readPdfPageSizes(Buffer.alloc(0), [1])).resolves.toEqual(new Map())
  })

  it('空页表直接返回空（不解析）', async () => {
    await expect(readPdfPageSizes(MINIMAL_PDF, [])).resolves.toEqual(new Map())
  })

  it('同一 Buffer 连续两次仍能读到尺寸', async () => {
    const data = Buffer.from(MINIMAL_PDF)
    const first = await readPdfPageSizes(data, [1])
    const second = await readPdfPageSizes(data, [1])
    expect(data.byteLength).toBe(MINIMAL_PDF.byteLength)
    expect(first.get(1)).toEqual({ width: 612, height: 792 })
    expect(second.get(1)).toEqual({ width: 612, height: 792 })
  })
})

describe('copyPdfBytesForPdfJs', () => {
  it('独立 backing：transfer 掏空拷贝不影响原 Buffer', async () => {
    const slab = Buffer.alloc(MINIMAL_PDF.byteLength + 64)
    MINIMAL_PDF.copy(slab, 32)
    const data = slab.subarray(32, 32 + MINIMAL_PDF.byteLength)
    const copy = copyPdfBytesForPdfJs(data)

    expect(copy.buffer).not.toBe(data.buffer)
    expect(copy.byteOffset).toBe(0)
    expect(copy.byteLength).toBe(data.byteLength)
    expect(Buffer.from(copy)).toEqual(MINIMAL_PDF)

    const { port1, port2 } = new MessageChannel()
    const received = new Promise<MessageEvent>((resolve) => {
      port2.onmessage = resolve
    })
    port1.postMessage(copy.buffer, [copy.buffer])
    await received

    expect(copy.byteLength).toBe(0)
    expect(data.byteLength).toBe(MINIMAL_PDF.byteLength)
    expect(Buffer.compare(Buffer.from(data), MINIMAL_PDF)).toBe(0)
    port1.close()
    port2.close()
  })
})
