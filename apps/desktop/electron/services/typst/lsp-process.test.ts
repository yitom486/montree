import { describe, expect, it } from 'vitest'
import { LspFramer, LspProcess, MAX_LSP_BYTES } from './lsp-process'
import os from 'node:os'

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message))
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
}
describe('Typst LSP UTF-8 framing', () => {
  it('handles every split boundary including Chinese, emoji and CRLF content', () => {
    const message = { jsonrpc: '2.0', method: 'test', params: { text: '中文 😀\r\n#let x = 1' } }
    const bytes = frame(message)
    for (let split = 1; split < bytes.length; split++) {
      const framer = new LspFramer()
      expect([...framer.push(bytes.subarray(0, split)), ...framer.push(bytes.subarray(split))]).toEqual([message])
    }
  })
  it('handles coalesced responses and partial next headers', () => {
    const framer = new LspFramer()
    const a = { id: 1, result: '字' }, b = { id: 2, result: '😀' }
    const next = frame(b)
    expect(framer.push(Buffer.concat([frame(a), next.subarray(0, 7)]))).toEqual([a])
    expect(framer.push(next.subarray(7))).toEqual([b])
  })
  it('rejects invalid headers, oversized payload declarations and non-object JSON', () => {
    for (const bytes of [Buffer.from('Bad: 3\r\n\r\n{}'), Buffer.from(`Content-Length: ${MAX_LSP_BYTES + 1}\r\n\r\n`), frame([]), frame(null), Buffer.alloc(8193, 'a')]) {
      expect(() => new LspFramer().push(bytes)).toThrow()
    }
  })
})

describe('Typst LSP process lifecycle', () => {
  it('rejects pending calls on process exit and rejects new calls', async () => {
    const exits: string[] = []
    const client = new LspProcess(process.execPath, ['-e', 'process.stdin.once("data",()=>process.exit(7))'], os.tmpdir(), () => {}, message => exits.push(message), () => ({}))
    await expect(client.request('initialize', {}, 3000)).rejects.toThrow(/exited/)
    await expect(client.request('test', {}, 100)).rejects.toThrow(/not running/)
    expect(exits).toHaveLength(1)
    await client.close()
  })
  it('times out requests and cleans up when the child never responds', async () => {
    const client = new LspProcess(process.execPath, ['-e', 'process.stdin.resume()'], os.tmpdir(), () => {}, () => {}, () => ({}))
    try { await expect(client.request('never', {}, 30)).rejects.toThrow(/timed out/) }
    finally { client.kill() }
  })
})
