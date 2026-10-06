import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** 自研最小 fixture 生成器：不引入新依赖，跨平台可跑。 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** 最小 stored（不压缩）zip，foliate / jszip 可读 */
function buildStoredZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encodeUtf8(entry.name)
    const crc = crc32(entry.data)
    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(0x0800), // UTF-8 文件名
      u16(0), // stored
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    )
    chunks.push(local)
    central.push(
      concat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ),
    )
    offset += local.length
  }
  const centralDir = concat(...central)
  const end = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  )
  return concat(...chunks, centralDir, end)
}

const EPUB_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Smoke Chapter</title></head>
<body><h1>Smoke Chapter</h1><p>Montree E2E minimal EPUB paragraph.</p></body>
</html>`

const EPUB_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Smoke Book</dc:title><dc:identifier id="bookid">montree-e2e-smoke</dc:identifier><dc:language>en</dc:language></metadata>
<manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="ch1"/></spine>
</package>`

const EPUB_CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

export async function writeMinimalEpub(filePath: string): Promise<void> {
  const zip = buildStoredZip([
    { name: 'mimetype', data: encodeUtf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: encodeUtf8(EPUB_CONTAINER) },
    { name: 'OEBPS/content.opf', data: encodeUtf8(EPUB_OPF) },
    { name: 'OEBPS/ch1.xhtml', data: encodeUtf8(EPUB_CHAPTER) },
  ])
  await writeFile(filePath, zip)
}

/** 多章节 EPUB：2 个 spine，每部下挂分片目录（复刻 z-library 大部头结构） */
export async function writeFoliateSectionsWorkspace(dir: string): Promise<{ epubName: string }> {
  await mkdir(dir, { recursive: true })
  const epubName = 'sections-book.epub'
  const filler = (text: string): string =>
    Array.from({ length: 30 }, (_, i) => `<p>${text} - filler paragraph ${i + 1}.</p>`).join('\n')
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sections Book</dc:title><dc:identifier id="bookid">sections</dc:identifier><dc:language>en</dc:language></metadata>
<manifest>
<item id="part1" href="part1.xhtml" media-type="application/xhtml+xml"/>
<item id="part2" href="part2.xhtml" media-type="application/xhtml+xml"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="part1"/><itemref idref="part2"/></spine>
</package>`
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="sections"/></head>
<docTitle><text>Sections Book</text></docTitle>
<navMap>
<navPoint id="p1" playOrder="1"><navLabel><text>Part One</text></navLabel><content src="part1.xhtml"/>
<navPoint id="c1" playOrder="2"><navLabel><text>Chapter 1</text></navLabel><content src="part1.xhtml#chap1"/></navPoint>
<navPoint id="c2" playOrder="3"><navLabel><text>Chapter 2</text></navLabel><content src="part1.xhtml#chap2"/></navPoint>
</navPoint>
<navPoint id="p2" playOrder="4"><navLabel><text>Part Two</text></navLabel><content src="part2.xhtml"/>
<navPoint id="c3" playOrder="5"><navLabel><text>Chapter 3</text></navLabel><content src="part2.xhtml#chap3"/></navPoint>
</navPoint>
</navMap></ncx>`
  const part1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Part One</title></head><body>
<h1 id="top1">Part One</h1>${filler('Part one intro')}
<h2 id="chap1">Chapter 1</h2>${filler('Chapter one body')}
<h2 id="chap2">Chapter 2</h2>${filler('Chapter two body')}
</body></html>`
  const part2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Part Two</title></head><body>
<h1 id="top2">Part Two</h1>${filler('Part two intro')}
<h2 id="chap3">Chapter 3</h2>${filler('Chapter three body')}
</body></html>`
  const container =
    '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>'
  const zip = buildStoredZip([
    { name: 'mimetype', data: encodeUtf8('application/epub+zip') },
    { name: 'META-INF/container.xml', data: encodeUtf8(container) },
    { name: 'OEBPS/content.opf', data: encodeUtf8(opf) },
    { name: 'OEBPS/toc.ncx', data: encodeUtf8(ncx) },
    { name: 'OEBPS/part1.xhtml', data: encodeUtf8(part1) },
    { name: 'OEBPS/part2.xhtml', data: encodeUtf8(part2) },
  ])
  await writeFile(join(dir, epubName), zip)
  return { epubName }
}
export async function writeMinimalMobi(filePath: string): Promise<void> {
  const enc = new TextEncoder()
  const be16 = (value: number): Uint8Array => {
    const buffer = new ArrayBuffer(2)
    new DataView(buffer).setUint16(0, value)
    return new Uint8Array(buffer)
  }
  const be32 = (value: number): Uint8Array => {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, value)
    return new Uint8Array(buffer)
  }
  const concatParts = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }
  const pad = (data: Uint8Array, size: number): Uint8Array => {
    const out = new Uint8Array(size)
    out.set(data.subarray(0, size))
    return out
  }

  const title = enc.encode('Smoke Mobi')
  const text = enc.encode(
    '<h1>Smoke Mobi Chapter</h1><p>Montree E2E minimal MOBI paragraph.</p>' +
      '<mbp:pagebreak/><h1>Second Mobi Chapter</h1><p>Second mobi paragraph.</p>',
  )

  // record0：PalmDOC 头（16B）+ MOBI 头（232B）+ 标题
  const palmdoc = concatParts(
    be16(1), // compression = 1（无压缩）
    new Uint8Array(6),
    be16(1), // numTextRecords
    be16(4096), // recordSize
    be16(0), // encryption
    new Uint8Array(2),
  )
  const mobiHead = new Uint8Array(232)
  const mobiView = new DataView(mobiHead.buffer)
  const writeAscii = (offset: number, value: string): void => {
    mobiHead.set(enc.encode(value), offset)
  }
  writeAscii(0, 'MOBI')
  mobiView.setUint32(4, 232) // length
  mobiView.setUint32(8, 2) // type = book
  mobiView.setUint32(12, 65001) // encoding = utf-8
  mobiView.setUint32(16, 1) // uid
  mobiView.setUint32(20, 6) // version = MOBI6
  mobiView.setUint32(68, 248) // titleOffset（record0 内偏移）
  mobiView.setUint32(72, title.length) // titleLength
  mobiHead[78] = 1 // localeRegion
  mobiHead[79] = 9 // localeLanguage
  mobiView.setUint32(92, 2) // resourceStart（越过末记录，永不访问）
  mobiView.setUint32(128 - 16, 0) // exthFlag = 0（无 EXTH）
  mobiView.setUint32(240 - 16, 0) // trailingFlags = 0
  mobiView.setUint32(244 - 16, 0xffffffff) // indx = none
  const rec0 = concatParts(palmdoc, mobiHead, title)

  // PDB 头（78B）+ 记录表
  const rec0Offset = 78 + 2 * 8
  const rec1Offset = rec0Offset + rec0.length
  const pdbHead = new Uint8Array(78)
  pdbHead.set(enc.encode('SmokeMobi'), 0)
  pdbHead.set(enc.encode('BOOKMOBI'), 60)
  new DataView(pdbHead.buffer).setUint16(76, 2) // numRecords
  const table = concatParts(be32(rec0Offset), new Uint8Array(4), be32(rec1Offset), new Uint8Array(4))

  await writeFile(filePath, concatParts(pdbHead, table, rec0, text))
}
export async function writeMinimalPdf(filePath: string): Promise<void> {
  const enc = new TextEncoder()
  const streamText = 'BT /F1 24 Tf 72 720 Td (Montree E2E minimal PDF paragraph.) Tj ET\n'
  const streamLen = enc.encode(streamText).length
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${streamLen} >>\nstream\n${streamText}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets: number[] = []
  let cursor = enc.encode(header).length
  objects.forEach((content, index) => {
    const entry = `${index + 1} 0 obj\n${content}\nendobj\n`
    offsets.push(cursor)
    body += entry
    cursor += enc.encode(entry).length
  })
  const xrefOffset = cursor
  const count = objects.length + 1
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  await writeFile(filePath, enc.encode(header + body + xref + trailer))
}

export async function writeReaderSmokeWorkspace(dir: string): Promise<{
  mdName: string
  pdfName: string
  epubName: string
}> {
  await mkdir(dir, { recursive: true })
  const mdName = 'smoke-demo.md'
  const pdfName = 'smoke-sample.pdf'
  const epubName = 'smoke-sample.epub'
  const md = [
    '# Reader Smoke',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    'Inline math \\(E=mc^2\\) and block:',
    '',
    '\\[\\frac{a}{b}\\]',
    '',
    '```ts',
    'const answer: number = 42',
    '```',
    '',
  ].join('\n')
  await writeFile(join(dir, mdName), md, 'utf-8')
  await writeMinimalPdf(join(dir, pdfName))
  await writeMinimalEpub(join(dir, epubName))
  return { mdName, pdfName, epubName }
}
