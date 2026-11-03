import type { InkdownMcpToolDefinition } from '@yitom/acp-client'
import { parseTranslationToolCall, TRANSLATION_TOOL_NAME, type TranslationOutputEnvelope, type TranslationToolCall } from '../../../../contracts/translation'
import { currentAcpContext, type AcpContext } from '../acp-context'

type Output = Omit<TranslationOutputEnvelope, 'runtimeId'>
interface Request {
  sessionId: string
  next: number
  history: Map<number, string>
  pending: Map<number, TranslationToolCall>
  chars: number
  done: boolean
}
const requests = new WeakMap<AcpContext, Map<string, Request>>()
const listeners = new WeakMap<AcpContext, Set<(event: Output) => void>>()

export function onTranslationOutput(listener: (event: Output) => void) {
  const owner = currentAcpContext()
  let set = listeners.get(owner)
  if (!set) { set = new Set(); listeners.set(owner, set) }
  set.add(listener)
  return () => { set.delete(listener) }
}

export function openTranslationOutput(requestId: string, sessionId: string) {
  const owner = currentAcpContext()
  if (owner.purpose !== 'translation' || owner.closed || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('翻译请求无效')
  let map = requests.get(owner)
  if (!map) { map = new Map(); requests.set(owner, map) }
  if (map.has(requestId)) throw new Error('翻译请求重复')
  map.set(requestId, { sessionId, next: 0, history: new Map(), pending: new Map(), chars: 0, done: false })
  return () => { map.delete(requestId) }
}

export function isTranslationOutputPermission(toolCall: Record<string, unknown> | undefined): boolean {
  const raw = toolCall?.rawInput
  const name = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).name : undefined
  if (![name, toolCall?.title].some((value) => typeof value === 'string' && value.endsWith(TRANSLATION_TOOL_NAME))) return false
  const args = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).arguments ?? raw : null
  const call = parseTranslationToolCall(args)
  const owner = currentAcpContext()
  return Boolean(call && owner.purpose === 'translation' && !owner.closed && requests.get(owner)?.has(call.requestId))
}

export const TRANSLATION_TOOLS: readonly InkdownMcpToolDefinition[] = [{
  name: TRANSLATION_TOOL_NAME,
  description: '向翻译卡提交一个结构化结果增量，type 与顺序以当前任务要求为准。解读阶段逐项提交 phrase/term，最后 done，不重复已经显示的译文。兼容 language/text 结果；text 只允许译文（每次最多600字符），严禁思考、计划或格式说明。sequence 从0连续递增。',
  inputSchema: { type: 'object', required: ['requestId', 'sequence', 'type'], additionalProperties: false,
    properties: {
      requestId: { type: 'string', description: '当前翻译请求的完整 requestId' },
      sequence: { type: 'integer', minimum: 0, maximum: 127 },
      type: { type: 'string', enum: ['language', 'text', 'phrase', 'term', 'done'] },
      sourceLanguage: { anyOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
      text: { type: 'string', minLength: 1, maxLength: 600 },
      meaning: { type: 'string', minLength: 1, maxLength: 400 },
    } },
}]

export async function callTranslationTool(name: string, _context: unknown, args?: Record<string, unknown>) {
  const reject = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] })
  const owner = currentAcpContext()
  const call = name === TRANSLATION_TOOL_NAME ? parseTranslationToolCall(args) : null
  const request = call ? requests.get(owner)?.get(call.requestId) : undefined
  if (owner.closed || owner.purpose !== 'translation' || !call || !request) return reject('翻译工具参数无效或请求已结束')
  const serialized = JSON.stringify(call)
  const previous = request.history.get(call.sequence)
  if (previous) return previous === serialized ? { content: [{ type: 'text' as const, text: '已接收' }] } : reject('同一序号的内容不一致')
  if (request.done || (call.type === 'text' && request.chars + call.text.length > 32000)) return reject('翻译输出已完成或超出长度限制')
  request.history.set(call.sequence, serialized)
  request.pending.set(call.sequence, call)
  if (call.type === 'text') request.chars += call.text.length
  while (request.pending.has(request.next)) {
    const { requestId, sequence, ...event } = request.pending.get(request.next)!
    request.pending.delete(request.next++)
    for (const listener of listeners.get(owner) ?? []) listener({ requestId, sequence, sessionId: request.sessionId, event })
    if (event.type === 'done') { request.done = true; request.pending.clear(); break }
  }
  return { content: [{ type: 'text' as const, text: '已接收；请继续下一项，done 后直接结束。' }] }
}
