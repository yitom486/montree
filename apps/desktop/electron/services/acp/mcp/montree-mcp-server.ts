import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { handleInkdownMcpRpc as handleMontreeMcpRpc, type McpRpcMessage } from "@yitom/acp-client"
import type {
  InkdownMcpToolContext,
  InkdownMcpToolDefinition,
} from "@yitom/acp-client"

export type MontreeMcpToolContext = InkdownMcpToolContext
export type MontreeMcpToolDefinition = InkdownMcpToolDefinition
import { callInkdownMcpTool as callMontreeMcpTool, INKDOWN_MCP_TOOLS as MONTREE_MCP_TOOLS } from "@yitom/acp-client"
import {
  callInkdownTocTool as callMontreeTocTool,
  INKDOWN_TOC_MCP_TOOLS as MONTREE_TOC_MCP_TOOLS,
} from "@yitom/acp-client"

const MCP_ENDPOINT_PATH = '/mcp'
const MAX_BODY_BYTES = 256 * 1024

/**
 * MCP Server 默认使用的冷门本地端口：
 * - 位于 1024-49151 注册端口段，避免与系统动态出站临时端口（49152-65535）碰撞。
 * - 远离 3000、5173、8080 等前端/常见开发端口。
 * - 主服务与 TOC 目录副服务分别使用独立的端口基数。
 */
export const DEFAULT_MONTREE_MCP_PORT = 39281
export const DEFAULT_MONTREE_TOC_MCP_PORT = 39291
const MAX_PORT_ATTEMPTS = 5

export interface MontreeMcpServerHandle {
  url: string
  authToken: string
  close: () => Promise<void>
}

let handle: MontreeMcpServerHandle | null = null
/** 目录副会话专用端点（只挂目录工具，主会话看不到） */
let tocHandle: MontreeMcpServerHandle | null = null

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

/**
 * 获取或持久化稳定的本地 MCP 令牌。
 * 存储于操作系统当前用户的临时目录下，文件仅当前用户有权限。
 * 避免开发热重载或主进程短暂重启后，已有长会话因 token 改变而收到 401 报错。
 */
export function getOrCreateAuthToken(label: string): string {
  try {
    const tokenFile = join(tmpdir(), `montree-mcp-${label}-token.txt`)
    if (existsSync(tokenFile)) {
      const saved = readFileSync(tokenFile, 'utf-8').trim()
      if (saved.length === 48 && /^[0-9a-f]+$/i.test(saved)) {
        return saved
      }
    }
    const token = randomBytes(24).toString('hex')
    writeFileSync(tokenFile, token, { encoding: 'utf-8', mode: 0o600 })
    return token
  } catch {
    return randomBytes(24).toString('hex')
  }
}

/**
 * 监听本地端口：
 * 1. 优先绑定指定的冷门固定端口（或环境变量指定的端口）。
 * 2. 若遇 EADDRINUSE，递增尝试若干备选端口（支持开发多实例或短暂占用）。
 * 3. 若多次尝试均被占用，优雅降级为 0（由操作系统分配空闲端口），确保服务始终可用。
 */
export function listenWithFallback(server: Server, preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!preferredPort) {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('MCP server 未获得端口'))
      })
      return
    }

    let currentPort = preferredPort
    let attempts = 0

    const tryListen = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        if (err.code === 'EADDRINUSE' && attempts < MAX_PORT_ATTEMPTS) {
          attempts++
          currentPort++
          console.warn(`[acp-mcp] 端口 ${currentPort - 1} 被占用，尝试备选端口 ${currentPort}`)
          tryListen()
          return
        }
        if (err.code === 'EADDRINUSE') {
          console.warn(`[acp-mcp] 冷门固定端口段均被占用，回退至系统动态端口 0`)
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (address && typeof address === 'object') resolve(address.port)
            else reject(new Error('MCP server 未获得端口'))
          })
          return
        }
        reject(err)
      }

      const onListening = () => {
        server.removeListener('error', onError)
        const address = server.address()
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('MCP server 未获得端口'))
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(currentPort, '127.0.0.1')
    }

    tryListen()
  })
}

/**
 * 将底层 @yitom/acp-client 的 inkdown_* 工具转译为标准的 montree_* 工具暴露给 Agent。
 */
export function adaptMontreeTools(
  tools: readonly MontreeMcpToolDefinition[],
): MontreeMcpToolDefinition[] {
  return tools.map((tool) => {
    let toolDef = tool
    if (tool.name.startsWith('inkdown_')) {
      toolDef = {
        ...tool,
        name: tool.name.replace(/^inkdown_/, 'montree_'),
        description: tool.description.replaceAll('inkdown_', 'montree_'),
      }
    }
    if (toolDef.name === 'montree_propose_mark') {
      const origProperties = (toolDef.inputSchema?.properties as Record<string, unknown>) ?? {}
      const origMarks = (origProperties.marks as Record<string, unknown>) ?? {}
      const origItems = (origMarks.items as Record<string, unknown>) ?? {}
      const origItemProperties = (origItems.properties as Record<string, unknown>) ?? {}

      const categorySchema = {
        type: 'string',
        enum: ['note', 'concept', 'quote', 'method', 'question', 'diagram'],
        description: '卡片分类：note=批注心得；concept=关键概念；quote=金句引用；method=方法操作；question=疑问探讨；diagram=关系图谱',
      }
      const titleSchema = {
        type: 'string',
        description: '卡片标题（简明概括，生成结构化知识卡片时推荐提供）',
      }

      toolDef = {
        ...toolDef,
        description:
          '唯一标记与知识卡片提议工具（高亮 / 批注 / 结构化卡片，不入库；用户「采用」后才写入）。' +
          '单条：excerpt（原句）+ 可选 note（批注正文）+ 可选 category（卡片分类：note/concept/quote/method/question/diagram）+ 可选 title（卡片标题）。' +
          '批量：marks 数组（每项支持 excerpt, note, category, title 等，单批≤10）。' +
          '仅在用户明确要求保存高亮/批注或制作知识卡片时调用。',
        inputSchema: {
          ...toolDef.inputSchema,
          properties: {
            ...origProperties,
            category: categorySchema,
            title: titleSchema,
            marks: {
              ...origMarks,
              items: {
                ...origItems,
                properties: {
                  ...origItemProperties,
                  category: categorySchema,
                  title: titleSchema,
                },
              },
            },
          },
        },
      }
    }
    return toolDef
  })
}

/**
 * 工具调用适配器：兼容 Agent 调用 montree_xxx 或历史 inkdown_xxx，统一映射到底层 SDK。
 */
export async function callAdaptedMontreeTool(
  name: string,
  context: MontreeMcpToolContext,
  args?: Record<string, unknown>,
) {
  const sdkName = name.startsWith('montree_')
    ? name.replace(/^montree_/, 'inkdown_')
    : name

  if (sdkName === 'inkdown_propose_mark') {
    const marks = args?.marks
    const excerpt = args?.excerpt
    const note = typeof args?.note === 'string' ? args.note : ''
    const noteOnly = typeof args?.note === 'string' && args.note.trim()
    if ((!Array.isArray(marks) || marks.length === 0) && (typeof excerpt !== 'string' || !excerpt.trim()) && !noteOnly) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'montree_propose_mark 需要 excerpt、marks 之一，或有选区时仅传 note',
          },
        ],
        isError: true,
      }
    }
    const text = await context.readSnapshot('propose-mark', {
      ...(typeof excerpt === 'string' ? { excerpt } : {}),
      note,
      kind: args?.kind === 'highlight' || args?.kind === 'note' || args?.kind === 'auto' ? args.kind : undefined,
      ...(typeof args?.flatIndex === 'number' && Number.isFinite(args.flatIndex) ? { flatIndex: args.flatIndex } : {}),
      ...(typeof args?.category === 'string' ? { category: args.category } : {}),
      ...(typeof args?.title === 'string' ? { title: args.title } : {}),
      ...(Array.isArray(marks) ? { marks } : {}),
    } as any)
    return { content: [{ type: 'text' as const, text }] }
  }

  return await callMontreeMcpTool(sdkName, context, args)
}

/**
 * 进程内 MCP server（Streamable HTTP 的最小子集）。
 * 单例：一个 App 一个端点，工具调用最终落到渲染进程内存快照。
 */
export async function startMontreeMcpServer(
  context: MontreeMcpToolContext,
): Promise<MontreeMcpServerHandle> {
  if (handle) return handle
  const tools = adaptMontreeTools(MONTREE_MCP_TOOLS)
  const envPort = process.env.MONTREE_MCP_PORT ? Number(process.env.MONTREE_MCP_PORT) : undefined
  const preferredPort = Number.isInteger(envPort) && (envPort ?? 0) > 0 ? envPort : DEFAULT_MONTREE_MCP_PORT
  handle = await serveMcpServer(context, tools, callAdaptedMontreeTool, 'montree', preferredPort)
  return handle
}

/**
 * 目录副会话专用端点：同一份传输/鉴权逻辑，只挂目录工具表。
 * 主会话的表一个字不动，目录 agent 也看不到主表。
 */
export async function startTocMcpServer(
  context: MontreeMcpToolContext,
): Promise<MontreeMcpServerHandle> {
  if (tocHandle) return tocHandle
  const envPort = process.env.MONTREE_TOC_MCP_PORT ? Number(process.env.MONTREE_TOC_MCP_PORT) : undefined
  const preferredPort = Number.isInteger(envPort) && (envPort ?? 0) > 0 ? envPort : DEFAULT_MONTREE_TOC_MCP_PORT
  tocHandle = await serveMcpServer(context, MONTREE_TOC_MCP_TOOLS, callMontreeTocTool, 'montree-toc', preferredPort)
  return tocHandle
}

async function serveMcpServer(
  context: MontreeMcpToolContext,
  tools: readonly MontreeMcpToolDefinition[],
  call: typeof callMontreeMcpTool,
  label: string,
  preferredPort?: number,
): Promise<MontreeMcpServerHandle> {
  const authToken = getOrCreateAuthToken(label)

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
        const rpcResponse = await handleMontreeMcpRpc(message, context, tools, call)
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

  const port = await listenWithFallback(server, preferredPort)
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

export async function stopMontreeMcpServer(): Promise<void> {
  await handle?.close()
  handle = null
  await tocHandle?.close()
  tocHandle = null
}
