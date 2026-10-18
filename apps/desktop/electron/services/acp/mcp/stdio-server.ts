import { createServer, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { handleInkdownMcpRpc, INKDOWN_MCP_TOOLS, INKDOWN_TOC_MCP_TOOLS, callInkdownTocTool, type McpRpcMessage } from '@yitom/acp-client'
import { bindAcpContext, currentAcpContext, type AcpContext } from '../acp-context'
import { adaptMontreeTools, callAdaptedMontreeTool, stopMontreeMcpServer, type MontreeMcpServerHandle, type MontreeMcpToolContext } from './montree-mcp-server'
import { READER_VISUAL_TOOLS, callReaderVisualTool } from './reader-visual-tools'
import { DOCUMENT_TOOLS, callDocumentTool } from './document-tools'
import { logAcpDiagnostic } from './diagnostics'
import { McpConnectionHealth } from './connection-health'

const states = new WeakMap<AcpContext, Map<string, Promise<MontreeMcpServerHandle>>>()

export function startWindowMcpServer(context: MontreeMcpToolContext, scope: 'full' | 'toc' = 'full'): Promise<MontreeMcpServerHandle> {
  const owner = currentAcpContext()
  if (owner.closed) return Promise.reject(new Error('Agent 所属窗口已关闭'))
  let state = states.get(owner)
  if (!state) { state = new Map(); states.set(owner, state) }
  const existing = state.get(scope)
  if (existing) return existing
  const pending = serve(context, scope)
  state.set(scope, pending)
  void pending.catch(() => {
    logAcpDiagnostic('mcp.server.start.failed', { server: scope === 'toc' ? 'montree-toc' : 'montree' })
    if (state.get(scope) === pending) state.delete(scope)
  })
  return pending
}

async function serve(context: MontreeMcpToolContext, scope: 'full' | 'toc'): Promise<MontreeMcpServerHandle> {
  const owner = currentAcpContext()
  const label = scope === 'toc' ? 'montree-toc' : 'montree'
  const nonce = randomBytes(16).toString('hex')
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\montree-${nonce}` : join(tmpdir(), `montree-${nonce}.sock`)
  const token = randomBytes(24).toString('hex')
  const tools = scope === 'toc' ? INKDOWN_TOC_MCP_TOOLS : [...adaptMontreeTools(INKDOWN_MCP_TOOLS), ...READER_VISUAL_TOOLS, ...DOCUMENT_TOOLS]
  const sockets = new Set<Socket>()
  const health = new McpConnectionHealth()
  const server = createServer(bindAcpContext((socket) => {
    sockets.add(socket)
    let authenticated = false
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', bindAcpContext(() => logAcpDiagnostic('mcp.pipe.error', { server: label })))
    socket.once('close', bindAcpContext(() => {
      sockets.delete(socket)
      health.closed(socket)
      logAcpDiagnostic('mcp.client.closed', { server: label, authenticated })
    }))
    socket.on('data', bindAcpContext(async (chunk: string) => {
      socket.pause()
      buffer += chunk
      try {
        while (buffer.includes('\n')) {
          const newline = buffer.indexOf('\n')
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (Buffer.byteLength(line) > 256 * 1024 || owner.closed) { socket.destroy(); return }
          if (!authenticated) {
            if (JSON.parse(line).token !== token) { logAcpDiagnostic('mcp.auth.rejected', { server: label }); socket.destroy(); return }
            authenticated = true
            socket.setTimeout(0)
            socket.write('{"ready":true}\n')
            logAcpDiagnostic('mcp.client.connected', { server: label, transport: 'stdio' })
            continue
          }
          let message: McpRpcMessage
          try { message = JSON.parse(line) as McpRpcMessage } catch {
            socket.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '解析失败' } }) + '\n')
            continue
          }
          const started = Date.now()
          const name = typeof message.params?.name === 'string' ? message.params.name : ''
          const extension = scope === 'full' && message.method === 'tools/call' && message.id != null
            ? DOCUMENT_TOOLS.some((tool) => tool.name === name) ? callDocumentTool
              : READER_VISUAL_TOOLS.some((tool) => tool.name === name) ? callReaderVisualTool : undefined
            : undefined
          let response: Record<string, unknown> | null
          try {
            response = extension
              ? { jsonrpc: '2.0', id: message.id, result: await extension(name, context, message.params?.arguments as Record<string, unknown> | undefined) }
              : await handleInkdownMcpRpc(message, context, tools, scope === 'toc' ? callInkdownTocTool : callAdaptedMontreeTool)
          } catch {
            response = { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: '工具执行失败' } }
          }
          // Only known tool names are logged; unknown names can contain untrusted text.
          logAcpDiagnostic('mcp.request', { server: label, method: ['initialize', 'tools/list', 'tools/call', 'ping'].includes(message.method ?? '') ? message.method : 'other', tool: tools.some((tool) => tool.name === name) ? name : undefined, durationMs: Date.now() - started, toolCount: message.method === 'tools/list' ? tools.length : undefined, failed: Boolean(response?.error || (response?.result as { isError?: boolean } | undefined)?.isError) })
          if (response && !socket.destroyed) {
            socket.write(JSON.stringify(response) + '\n')
            if (message.method === 'tools/list' && !response.error) health.discovered(socket)
          }
        }
        if (Buffer.byteLength(buffer) > 256 * 1024) socket.destroy()
      } catch { socket.destroy() }
      finally { if (!socket.destroyed) socket.resume() }
    }))
  }))
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, () => { server.off('error', reject); resolve() }) })
  server.on('error', bindAcpContext(() => logAcpDiagnostic('mcp.server.error', { server: label })))
  logAcpDiagnostic('mcp.server.started', { server: label, transport: 'stdio', toolCount: tools.length })
  let closed = false
  const handle: MontreeMcpServerHandle = {
    health,
    url: endpoint,
    authToken: token,
    close: async () => {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (process.platform !== 'win32') { try { unlinkSync(endpoint) } catch { /* net already removed it */ } }
      logAcpDiagnostic('mcp.server.closed', { server: label })
    },
  }
  if (owner.closed) { await handle.close(); throw new Error('Agent 所属窗口已关闭') }
  return handle
}

export async function stopWindowMcpServers(): Promise<void> {
  await stopMontreeMcpServer() // Legacy HTTP endpoints are only used by diagnostic/E2E hooks.
  const state = states.get(currentAcpContext())
  if (!state) return
  const results = await Promise.allSettled(state.values())
  await Promise.all(results.map((result) => result.status === 'fulfilled' ? result.value.close() : undefined))
  states.delete(currentAcpContext())
}
