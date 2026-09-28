import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { handleInkdownMcpRpc, type McpRpcMessage } from "@yitom/acp-client"
import type {
  InkdownMcpToolContext,
  InkdownMcpToolDefinition,
} from "@yitom/acp-client"
import { callInkdownMcpTool, INKDOWN_MCP_TOOLS } from "@yitom/acp-client"
import {
  callInkdownTocTool,
  INKDOWN_TOC_MCP_TOOLS,
} from "@yitom/acp-client"

const MCP_ENDPOINT_PATH = '/mcp'
const MAX_BODY_BYTES = 256 * 1024

export interface InkdownMcpServerHandle {
  url: string
  authToken: string
  close: () => Promise<void>
}

let handle: InkdownMcpServerHandle | null = null
/** 目录副会话专用端点（只挂目录工具，主会话看不到） */
let tocHandle: InkdownMcpServerHandle | null = null

function readBody(
  request: NodeJS.ReadableStream & { destroy: () => void },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    request.on('error', reject)
  })
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // 仅绑回环地址：不暴露到局域网
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve(address.port)
      else reject(new Error('MCP server 未获得端口'))
    })
  })
}

/**
 * 进程内 MCP server（Streamable HTTP 的最小子集）。
 * 单例：一个 App 一个端点，工具调用最终落到渲染进程内存快照。
 */
export async function startInkdownMcpServer(
  context: InkdownMcpToolContext,
): Promise<InkdownMcpServerHandle> {
  if (handle) return handle
  handle = await serveMcpServer(context, INKDOWN_MCP_TOOLS, callInkdownMcpTool, 'inkdown')
  return handle
}

/**
 * 目录副会话专用端点：同一份传输/鉴权逻辑，只挂目录工具表。
 * 主会话的表一个字不动，目录 agent 也看不到主表。
 */
export async function startTocMcpServer(
  context: InkdownMcpToolContext,
): Promise<InkdownMcpServerHandle> {
  if (tocHandle) return tocHandle
  tocHandle = await serveMcpServer(context, INKDOWN_TOC_MCP_TOOLS, callInkdownTocTool, 'inkdown-toc')
  return tocHandle
}

async function serveMcpServer(
  context: InkdownMcpToolContext,
  tools: readonly InkdownMcpToolDefinition[],
  call: typeof callInkdownMcpTool,
  label: string,
): Promise<InkdownMcpServerHandle> {
  const authToken = randomBytes(24).toString('hex')

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST' }).end()
        return
      }
      if ((request.url ?? '').split('?')[0] !== MCP_ENDPOINT_PATH) {
        response.writeHead(404).end()
        return
      }
      if (request.headers.authorization !== `Bearer ${authToken}`) {
        response.writeHead(401).end()
        return
      }

      let message: McpRpcMessage
      try {
        message = JSON.parse(await readBody(request)) as McpRpcMessage
      } catch {
        response
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '解析失败' } }))
        return
      }

      try {
        const rpcResponse = await handleInkdownMcpRpc(message, context, tools, call)
        if (!rpcResponse) {
          response.writeHead(202).end()
          return
        }
        console.info('[acp-mcp] handled', {
          server: label,
          method: message.method,
          tool: typeof message.params?.name === 'string' ? message.params.name : undefined,
        })
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(rpcResponse))
      } catch (error) {
        console.error('[acp-mcp] 处理失败', error)
        response.writeHead(500, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id ?? null,
            error: { code: -32603, message: '内部错误' },
          }),
        )
      }
    })()
  })

  const port = await listen(server)
  console.info('[acp-mcp] server 已启动', { server: label, port })

  return {
    url: `http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`,
    authToken,
    close: () =>
      new Promise<void>((resolve) => {
        // 必须先断开 keep-alive 连接：只调 close() 会一直等连接排空，
        // 而 MCP 客户端通常保持长连接，会把 disconnectAcp 卡死。
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export async function stopInkdownMcpServer(): Promise<void> {
  await handle?.close()
  handle = null
  await tocHandle?.close()
  tocHandle = null
}
