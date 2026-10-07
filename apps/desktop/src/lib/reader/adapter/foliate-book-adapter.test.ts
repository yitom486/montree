// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { detectAdapterBookKind } from '@/lib/reader/reader-adapter'
import { openFoliateBook } from './foliate-book-adapter'

/**
 * happy-dom 未实现 lookupNamespaceURI（浏览器原生有），foliate 解析 OPF 需要。
 * 仅本文件垫片；生产跑在 Chromium 无需处理。
 */
if (
  typeof Document !== 'undefined' &&
  !(Document.prototype as unknown as Record<string, unknown>)['lookupNamespaceURI']
) {
  const lookup = function (
    this: { getAttribute?: (name: string) => string | null; parentNode?: unknown },
    prefix: string | null,
  ): string | null {
    let current: { getAttribute?: (name: string) => string | null; parentNode?: unknown } | null | undefined =
      this
    const attr = prefix === null ? 'xmlns' : `xmlns:${prefix}`
    while (current) {
      const value = current.getAttribute?.(attr)
      if (value) return value
      current = current.parentNode as typeof current
    }
    return null
  }
  let proto: Record<string, unknown> | null = Document.prototype as unknown as Record<string, unknown>
  while (proto && proto !== Object.prototype) {
    proto['lookupNamespaceURI'] ??= lookup
    proto['lookupPrefix'] ??= function (): string | null {
      return null
    }
    proto = Object.getPrototypeOf(proto)
  }
}

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Adapter Smoke</dc:title><dc:identifier id="bookid">smoke</dc:identifier><dc:language>en</dc:language></metadata>
<manifest>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`

const NCX = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="smoke"/></head>
<docTitle><text>Adapter Smoke</text></docTitle>
<navMap>
<navPoint id="ch1" playOrder="1"><navLabel><text>First Chapter</text></navLabel><content src="ch1.xhtml"/></navPoint>
</navMap></ncx>`

const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head>
<body><h1>Adapter Chapter One</h1><p>Adapter paragraph for text extraction.</p></body></html>`

const CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

function buildSmokeEpub(): Uint8Array {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(OPF),
    'OEBPS/toc.ncx': strToU8(NCX),
    'OEBPS/ch1.xhtml': strToU8(CHAPTER),
  })
}

const OPF_TWO = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Two Sections</dc:title><dc:identifier id="bookid">two</dc:identifier><dc:language>en</dc:language></metadata>
<manifest>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`

const NCX_TWO = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="two"/></head>
<docTitle><text>Two Sections</text></docTitle>
<navMap>
<navPoint id="ch1" playOrder="1"><navLabel><text>First</text></navLabel><content src="ch1.xhtml"/></navPoint>
<navPoint id="ch2" playOrder="2"><navLabel><text>Second</text></navLabel><content src="ch2.xhtml"/></navPoint>
</navMap></ncx>`

const CHAPTER_TWO =
  '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch2</title></head><body><h1>Second Section</h1><p>Second section text.</p></body></html>'

function buildTwoSectionEpub(): Uint8Array {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(OPF_TWO),
    'OEBPS/toc.ncx': strToU8(NCX_TWO),
    'OEBPS/ch1.xhtml': strToU8(CHAPTER),
    'OEBPS/ch2.xhtml': strToU8(CHAPTER_TWO),
  })
}

describe('detectAdapterBookKind', () => {
  it('按扩展名判定容器（含 kf8 变体）', () => {
    expect(detectAdapterBookKind('a.epub')).toBe('epub')
    expect(detectAdapterBookKind('b.mobi')).toBe('mobi')
    expect(detectAdapterBookKind('c.azw3')).toBe('kf8')
    expect(detectAdapterBookKind('C.AZW')).toBe('kf8')
    expect(detectAdapterBookKind('d.pdf')).toBe('unknown')
  })
})

describe('FoliateBookAdapter', () => {
  it('makeBook 真入口可识别自造 EPUB（统一识别路径）', async () => {
    const { makeBook } = await import('@foliate/view.js')
    const bytes = buildSmokeEpub()
    const file = new File([bytes as BlobPart], 'smoke.epub', { type: 'application/epub+zip' })
    const book = await makeBook(file)
    expect(book.metadata?.title).toBe('Adapter Smoke')
    expect(book.sections).toHaveLength(1)
  })

  it('解析元数据、章节与目录并归一 spine 序号', async () => {
    const adapter = await openFoliateBook(buildSmokeEpub(), 'smoke.epub')
    try {
      expect(adapter.kind).toBe('epub')
      expect(adapter.title).toBe('Adapter Smoke')
      expect(adapter.sections).toHaveLength(1)
      expect(adapter.sections[0]?.id).toContain('ch1.xhtml')
      expect(adapter.toc).toHaveLength(1)
      expect(adapter.toc[0]?.label).toContain('First Chapter')
      expect(adapter.toc[0]?.sectionIndex).toBe(0)
    } finally {
      adapter.destroy()
    }
  })

  it('章节纯文本可供 Agent 与导出使用', async () => {
    const adapter = await openFoliateBook(buildSmokeEpub(), 'smoke.epub')
    try {
      const text = await adapter.loadSectionText(0)
      expect(text).toContain('Adapter Chapter One')
      expect(text).toContain('Adapter paragraph for text extraction.')
      expect(await adapter.loadSectionText(99)).toBe('')
    } finally {
      adapter.destroy()
    }
  })

  it('resolveHref 支持精确、碎片与 basename 回退', async () => {
    const adapter = await openFoliateBook(buildSmokeEpub(), 'smoke.epub')
    try {
      expect(adapter.resolveHref('OEBPS/ch1.xhtml')).toBe(0)
      expect(adapter.resolveHref('OEBPS/ch1.xhtml#frag')).toBe(0)
      expect(adapter.resolveHref('ch1.xhtml')).toBe(0)
      expect(adapter.resolveHref('OEBPS/missing.xhtml')).toBeNull()
      expect(adapter.resolveHref('')).toBeNull()
    } finally {
      adapter.destroy()
    }
  })

  it('resolveHref 支持 MOBI/AZW3 特有 href（通过 splitTOCHref / resolveHref 解析）', async () => {
    const adapter = await openFoliateBook(buildSmokeEpub(), 'smoke.epub')
    try {
      const engine = adapter.engineBook as unknown as {
        splitTOCHref?: (href: string) => [number, string]
      }
      engine.splitTOCHref = (href: string) => {
        if (href.startsWith('filepos:100')) return [0, 'filepos100']
        if (href.startsWith('kindle:pos:fid:0001')) return [0, 'pos1']
        return [-1, '']
      }
      expect(adapter.resolveHref('filepos:100')).toBe(0)
      expect(adapter.resolveHref('kindle:pos:fid:0001:off:0000000000')).toBe(0)
      expect(adapter.resolveHref('filepos:999')).toBeNull()
    } finally {
      adapter.destroy()
    }
  })

  it('CFI 按包级 spine 步进归属，越界拒绝', async () => {
    const adapter = await openFoliateBook(buildSmokeEpub(), 'smoke.epub')
    try {
      // 非 CFI 直接拒绝
      expect(await adapter.resolveLegacyEpubCfi('not-a-cfi')).toBeNull()
      // 单节书：第 0 节命中，第 1 节步进越界拒绝（不再宽容误归首节）
      expect(await adapter.resolveLegacyEpubCfi('epubcfi(/6/2!/4/2)')).toMatchObject({
        sectionIndex: 0,
      })
      expect(await adapter.resolveLegacyEpubCfi('epubcfi(/6/4!/4/2/2)')).toBeNull()
      expect(adapter.toLegacyEpubCfi({ sectionIndex: 0, cfi: 'epubcfi(/6/4)' })).toBe('epubcfi(/6/4)')
    } finally {
      adapter.destroy()
    }
  })

  it('旧链 CFI 按包级 spine 步进精确定位章节（多章节书）', async () => {
    const adapter = await openFoliateBook(buildTwoSectionEpub(), 'two.epub')
    try {
      expect(adapter.sections).toHaveLength(2)
      expect(await adapter.resolveLegacyEpubCfi('epubcfi(/6/2!/4/2)')).toMatchObject({
        sectionIndex: 0,
      })
      expect(await adapter.resolveLegacyEpubCfi('epubcfi(/6/4!/4/2/2)')).toMatchObject({
        sectionIndex: 1,
      })
      // 越界 spine 步进拒绝，不误归属首节
      expect(await adapter.resolveLegacyEpubCfi('epubcfi(/6/8!/4/2)')).toBeNull()
    } finally {
      adapter.destroy()
    }
  })
})
