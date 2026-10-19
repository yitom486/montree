import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TypstService } from './typst-service'
import type { TypstEvent } from '@yitom/contracts'

const executable = process.env.MONTREE_TINYMIST_PATH || path.resolve('apps/desktop/resources/typst', process.platform === 'win32' ? 'tinymist.exe' : 'tinymist')
async function pdfText(bytes: Buffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }) as unknown as {
    promise: Promise<{ getPage: (page: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }> }>
    destroy: () => Promise<void>
  }
  try {
    const document = await task.promise
    const text = await (await document.getPage(1)).getTextContent()
    return text.items.map(item => item.str ?? '').join('')
  } finally { await task.destroy() }
}
describe.skipIf(!existsSync(executable))('real Tinymist 0.15.8', () => {
  it('previews unsaved Unicode buffers, completes, diagnoses and exports current PDF bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'montree-typst-'))
    const file = path.join(root, '中文 😀.typ')
    const events: TypstEvent[] = []
    const service = new TypstService({ userData: path.join(root, 'data'), bundledExecutable: executable, emit: (_, event) => events.push(event) })
    try {
      await writeFile(file, '= Disk version')
      expect(await service.status()).toMatchObject({ available: true })
      const session = await service.open(1, { filePath: file, content: '#let greeting = "BUFFER_UNSAVED"\n= 中文与数学\n#greeting\n$ sum_(i=1)^n i $', version: 1 })
      expect(session.previewError).toBeUndefined()
      expect(session.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      const html = await (await fetch(session.previewUrl!)).text()
      expect(html).toContain('<html')
      const completions = await service.request(1, { sessionId: session.sessionId, method: 'textDocument/completion', params: { textDocument: { uri: session.uri }, position: { line: 2, character: 3 } }, version: 1 })
      const items = Array.isArray(completions) ? completions : (completions as { items: Array<{ label: string }> }).items
      expect(items.some((item: { label: string }) => item.label === 'greeting')).toBe(true)
      const pdf = await service.pdf(1, session.sessionId, 1)
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      const exportedText = await pdfText(pdf)
      expect(exportedText).toContain('BUFFER_UNSAVED')
      expect(exportedText).toContain('中文与数学')
      const htmlBytes = await service.html(1, session.sessionId, 1)
      const htmlText = htmlBytes.toString('utf8')
      expect(htmlText.toLowerCase()).toContain('<!doctype html')
      expect(htmlText).toContain('BUFFER_UNSAVED')
      const hover = await service.request(1, { sessionId: session.sessionId, method: 'textDocument/hover', params: { textDocument: { uri: session.uri }, position: { line: 2, character: 4 } }, version: 1 })
      expect(hover).toBeTruthy()
      const definition = await service.request(1, { sessionId: session.sessionId, method: 'textDocument/definition', params: { textDocument: { uri: session.uri }, position: { line: 2, character: 4 } }, version: 1 })
      expect(definition).toBeTruthy()
      await service.sync(1, { sessionId: session.sessionId, content: '#unknown_identifier', version: 2 })
      await expect.poll(() => events.some(e => e.type === 'notification' && e.method === 'textDocument/publishDiagnostics' && (e.params as { diagnostics: unknown[] }).diagnostics.length > 0), { timeout: 10000 }).toBe(true)
      await expect(service.sync(1, { sessionId: session.sessionId, content: 'stale', version: 1 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
      await expect(service.pdf(1, session.sessionId, 2)).rejects.toThrow()
      await service.sync(1, { sessionId: session.sessionId, content: '😀 #unknown_identifier', version: 3 })
      await expect.poll(() => events.some(e => e.type === 'notification' && e.method === 'textDocument/publishDiagnostics' && (e.params as { diagnostics: Array<{ range: { start: { character: number } } }> }).diagnostics.some(d => d.range.start.character === 4)), { timeout: 10000 }).toBe(true)
      await service.sync(1, { sessionId: session.sessionId, content: '#let x=1\n#x', version: 4 })
      const formatting = await service.request(1, { sessionId: session.sessionId, method: 'textDocument/formatting', params: { textDocument: { uri: session.uri }, options: { tabSize: 2, insertSpaces: true } }, version: 4 })
      expect(Array.isArray(formatting)).toBe(true)
      await expect(service.request(2, { sessionId: session.sessionId, method: 'textDocument/hover', params: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(service.close(2, session.sessionId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await readFile(file, 'utf8')).toBe('= Disk version')
      await service.close(1, session.sessionId)
      await expect(fetch(session.previewUrl!)).rejects.toThrow()
    } finally { service.disposeAll(); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  }, 60000)
  it('shares unsaved dependency buffers within a project, isolates windows and cleans pending opens', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'montree-typst-project-'))
    const main = path.join(root, 'main.typ'), child = path.join(root, 'child.typ')
    const events: Array<{ owner: number; event: TypstEvent }> = []
    const service = new TypstService({ userData: path.join(root, 'data'), bundledExecutable: executable, emit: (owner, event) => events.push({ owner, event }) })
    try {
      await writeFile(main, '#include "child.typ"')
      await writeFile(child, 'DISK_CHILD')
      await service.saveConfig({ executablePath: '', fontPaths: [], systemFonts: true, entryPath: main }, child)
      const a = await service.open(10, { filePath: child, rootPath: root, content: 'WINDOW_A_BUFFER', version: 1 })
      const b = await service.open(20, { filePath: child, rootPath: root, content: 'WINDOW_B_BUFFER', version: 1 })
      const entry = await service.open(10, { filePath: main, rootPath: root, content: 'MAIN_PREFIX\n#include "child.typ"', version: 1 })
      expect(a.previewUrl).not.toBe(b.previewUrl)
      expect(entry.previewError).toBeUndefined()
      const textA = await pdfText(await service.pdf(10, entry.sessionId, 1))
      expect(textA).toContain('MAIN_PREFIX')
      expect(textA).toContain('WINDOW_A_BUFFER')
      expect(textA).not.toContain('WINDOW_B_BUFFER')
      expect(await pdfText(await service.pdf(20, b.sessionId, 1))).toContain('WINDOW_B_BUFFER')
      await service.sync(10, { sessionId: a.sessionId, content: 'CHILD_EDIT_UNSAVED', version: 2 })
      expect(await pdfText(await service.pdf(10, entry.sessionId, 1))).toContain('CHILD_EDIT_UNSAVED')
      await expect(service.request(10, { sessionId: a.sessionId, method: 'textDocument/hover', params: { textDocument: { uri: b.uri + '.other' }, position: { line: 0, character: 1 } } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(service.request(10, { sessionId: a.sessionId, method: 'workspace/executeCommand' as never, params: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      service.disposeOwner(10)
      await expect(service.sync(10, { sessionId: a.sessionId, content: 'closed', version: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(await pdfText(await service.pdf(20, b.sessionId, 1))).toContain('WINDOW_B_BUFFER')
      expect(await readFile(child, 'utf8')).toBe('DISK_CHILD')
      await service.close(20, b.sessionId)
      const pending = service.open(30, { filePath: child, content: 'cancelled', version: 1 })
      service.disposeOwner(30)
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    } finally { service.disposeAll(); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  }, 60000)
  it('streams actual preview rendering changes over the upstream WebSocket without saving', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'montree-typst-preview-'))
    const file = path.join(root, 'preview.typ')
    const service = new TypstService({ userData: path.join(root, 'data'), bundledExecutable: executable, emit: () => {} })
    let socket: WebSocket | undefined
    try {
      await writeFile(file, 'DISK_PREVIEW')
      const session = await service.open(1, { filePath: file, content: '= Initial buffer', version: 1 })
      const frames: Buffer[] = []
      socket = new WebSocket(session.previewUrl!.replace('http:', 'ws:') + '/')
      socket.binaryType = 'arraybuffer'
      socket.addEventListener('message', event => { if (event.data instanceof ArrayBuffer) frames.push(Buffer.from(event.data)) })
      await new Promise<void>((resolve, reject) => { socket!.addEventListener('open', () => resolve(), { once: true }); socket!.addEventListener('error', () => reject(new Error('Preview WebSocket failed')), { once: true }) })
      socket.send('current')
      await expect.poll(() => frames.some(frame => frame.byteLength > 256), { timeout: 10000 }).toBe(true)
      const initial = frames.map(frame => frame.toString('base64'))
      const before = frames.length
      await service.sync(1, { sessionId: session.sessionId, content: '= Updated buffer\n\nNew content $ x^2 $', version: 2 })
      await expect.poll(() => frames.slice(before).some(frame => frame.byteLength > 256 && !initial.includes(frame.toString('base64'))), { timeout: 10000 }).toBe(true)
      expect(await pdfText(await service.pdf(1, session.sessionId, 2))).toContain('Updated buffer')
      expect(await readFile(file, 'utf8')).toBe('DISK_PREVIEW')
      socket.close()
      await service.close(1, session.sessionId)
    } finally { socket?.close(); service.disposeAll(); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  }, 60000)
  it('renders relative Unicode SVG images, tables and references, and diagnoses missing resources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'montree-typst-assets-'))
    const file = path.join(root, '图片与引用.typ')
    const fontPath = path.join(root, '附加字体')
    const events: TypstEvent[] = []
    const service = new TypstService({ userData: path.join(root, 'data'), bundledExecutable: executable, emit: (_, event) => events.push(event) })
    const source = '#set heading(numbering: "1.")\n= Resource Section <resource-section>\n\n#image("图.svg", width: 3cm)\n\n#table(columns: 2, [Metric], [Value], [TABLE_MARKER], [42])\n\nSee @resource-section.\n'
    try {
      await mkdir(fontPath)
      await writeFile(path.join(root, '图.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#2563eb"/><circle cx="60" cy="30" r="20" fill="#fbbf24"/></svg>')
      await writeFile(file, source)
      await service.saveConfig({ executablePath: '', fontPaths: [fontPath], systemFonts: true, entryPath: '' }, file)
      expect((await service.getConfig(file)).fontPaths).toEqual([fontPath])
      const session = await service.open(1, { filePath: file, content: source, version: 1 })
      expect(session.previewError).toBeUndefined()
      const text = await pdfText(await service.pdf(1, session.sessionId, 1))
      expect(text).toContain('Resource Section')
      expect(text).toContain('TABLE_MARKER')
      expect(text).toContain('42')
      expect(text).toMatch(/See\s*Section\s*1/)
      await service.sync(1, { sessionId: session.sessionId, content: source.replace('图.svg', '缺失.svg'), version: 2 })
      await expect.poll(() => events.some(event => event.type === 'notification' && event.method === 'textDocument/publishDiagnostics' &&
        (event.params as { diagnostics: Array<{ severity?: number; message: string }> }).diagnostics.some(d => d.severity === 1 && /file not found|failed to load|cannot find|does not exist/i.test(d.message))), { timeout: 10000 }).toBe(true)
      await expect(service.pdf(1, session.sessionId, 2)).rejects.toThrow()
      await service.close(1, session.sessionId)
    } finally { service.disposeAll(); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
  }, 60000)
})
