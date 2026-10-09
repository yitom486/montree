import type { BookBlockType } from '@montree/contracts'
import { normalizeWatermarkText } from './ocr-watermark'

/**
 * 正文水印补丁规划器（纯函数，只产出提案，不碰库）。
 *
 * 安全边界（Phase 2.1 冻结，P0.3 追加一条窄规则）：
 * - 绝不复用 cleanOcrWatermarks / expandWatermarkFragments：自动碎片扩展会把单字
 *   “王”收进水印集合并允许 token 修剪，本模块禁止这种行为。
 * - 显式规则，无“母体包含子串”“家族模糊匹配”“单字/双字自动扩展”：
 *   1. wholeBlockOnly：整个 block 归一化后完全相等才删除（单字“王”只删独立块，
 *      “王 DMA 方式”不动）。
 *   2. trimEligible：归一化长度 ≥3 的显式 token，只修空白分隔的首尾。
 *   3. attached-start:早机教育（P0.3，P0.2 审计结论 60/60 同形态才立项）：
 *      非 table 块去前导空白后精确以“早机教育”开头，删恰好 4 字，
 *      剩余 trim 非空；不碰结尾/中间/其他词。仅当前两者未命中才尝试，
 *      同一 block 至多一条补丁。
 *   4. custom-edge（P1，显式参数传入，不写成硬编码）：归一化 token 只匹配
 *      空白分隔的首/尾 token（首边优先，只替换一边）；整块恰为 token、
 *      余空、table、中间命中一律不补丁。仅当前三者未命中才尝试，
 *      内置优先，同一 block 至多一条补丁。
 * - type=table 永不产出补丁；输出只含 { id, action, before, after?, reason, pageNumber }，
 *   不携带、不修改 id/坐标/章节归属/type/confidence。
 */

export interface BodyBlockInput {
  id: number
  type: BookBlockType
  content: string
  pageNumber: number
}

export interface BodyWatermarkPlanOptions {
  /**
   * P1 自定义边缘 token（用户输入原文，内部归一化校验）。
   * 显式参数，不写成硬编码规则；非法值等价于未传（调用方应先用
   * validateCustomEdgeToken 校验并提示）。
   */
  customEdgeToken?: unknown
  /** 整块删除的水印归一化词表（外部注入或整书发现；若未传使用缺省兼容表） */
  wholeBlockWatermarks?: readonly string[]
  /** 首尾修剪的水印归一化词表（外部注入或整书发现；若未传使用缺省兼容表） */
  trimWatermarks?: readonly string[]
  /** 依附开头的特定前缀（可外部配置） */
  attachedStartPrefix?: string
}

/**
 * 自定义水印文本校验（纯函数）。归一化后长度须 3–24；拒绝空值、
 * 纯标点（归一化后为空）、纯数字、超长。返回归一化 token 供匹配用。
 */
export function validateCustomEdgeToken(
  input: unknown,
): { ok: true; token: string } | { ok: false; reason: string } {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ok: false, reason: '自定义水印文本不能为空' }
  }
  const token = normalizeWatermarkText(input)
  if (token.length === 0) {
    return { ok: false, reason: '自定义水印文本不能是纯标点或空白' }
  }
  if ([...token].length < 3) {
    return { ok: false, reason: '自定义水印文本至少需要 3 个字符' }
  }
  if ([...token].length > 24) {
    return { ok: false, reason: '自定义水印文本最多 24 个字符' }
  }
  if (/^[\p{N}]+$/u.test(token)) {
    return { ok: false, reason: '自定义水印文本不能是纯数字' }
  }
  return { ok: true, token }
}

export type BodyWatermarkAction = 'delete' | 'update'

export interface BodyWatermarkPatch {
  id: number
  action: BodyWatermarkAction
  before: string
  /** update 才有；delete 无 after */
  after?: string
  reason: string
  pageNumber: number
}

/**
 * 整块删除表（归一化键，显式列出；来源：真书 8889 块只读审计，
 * 独立成块且跨页出现的水印 OCR 碎片；拉丁单字母/疑似合法词一律排除）。
 */
export const WHOLE_BLOCK_ONLY_WATERMARKS: readonly string[] = [
  '王',
  '育',
  '王道',
  '教育',
  '机教',
  '道计',
  '算机',
  '文育',
  '王道计',
  '机教育',
  '早机教育',
  '算机教育',
  '计算机教育',
  '王道计算',
  '道计算机教育',
  '算机教',
  '王道计算机教育',
  // 下列为封面/广告页实录的无分隔叠写（逐字出现过才收录，不做模式扩展）：
  '王道计算机王道计算机教育',
  '王道计算机教育王道计',
]

/**
 * 首尾修剪表（归一化 token，显式列出；长度全部 ≥3，单字/双字不得入内，
 * 所以“王”“育”“王道”“教育”只删整块、不修剪文本）。
 */
export const TRIM_ELIGIBLE_WATERMARKS: readonly string[] = [
  '王道计',
  '机教育',
  '早机教育',
  '算机教育',
  '计算机教育',
  '王道计算',
  '道计算机教育',
  '算机教',
  '王道计算机教育',
]

const wholeBlockSet = new Set<string>(WHOLE_BLOCK_ONLY_WATERMARKS)
const trimSet = new Set<string>(TRIM_ELIGIBLE_WATERMARKS)

interface TokenSpan {
  text: string
  start: number
  end: number
}

function splitTokenSpans(content: string): TokenSpan[] {
  const spans: TokenSpan[] = []
  const re = /\S+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    spans.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return spans
}

/**
 * P0.3 窄规则 attached-start:早机教育（P0.2 审计结论 60/60 同形态才立项）。
 * 仅在 whole / 空白分隔修剪均未命中时调用（fallback 顺序），以此保证
 * 同一 block 至多一条补丁、既有行为逐字不变。
 * 条件（缺一即 null）：非 table（入口已保证）；去原始前导空白后精确以
 * “早机教育”开头（字面量，不归一化、不家族扩展）；删恰好 4 字，其后一切
 * 原样保留；剩余 trim() 非空。不碰结尾/中间/其他词。
 */
const NARROW_ATTACHED_START_PREFIX = '早机教育'

function planAttachedStart(block: BodyBlockInput, prefix: string | null): BodyWatermarkPatch | null {
  if (!prefix) return null
  const leading = /^\s*/.exec(block.content)?.[0] ?? ''
  const rest = block.content.slice(leading.length)
  if (!rest.startsWith(prefix)) return null
  const after = leading + rest.slice(prefix.length)
  if (after === block.content || after.trim().length === 0) return null
  return {
    id: block.id,
    action: 'update',
    before: block.content,
    after,
    reason: `attached-start:${prefix}`,
    pageNumber: block.pageNumber,
  }
}

/**
 * P1 自定义边缘匹配。仅空白边界：首 token 或尾 token 归一化后等于 token
 * 才剥离一边（首边优先），且只做一次替换。整块恰为 token 时不删
 * （整块删除只允许内置 allowlist）。余 trim 为空也不补丁。
 * 无空格黏连、中间命中、table 均不命中；不用正则。
 */
function planCustomEdge(block: BodyBlockInput, token: string): BodyWatermarkPatch | null {
  const spans = splitTokenSpans(block.content)
  if (spans.length === 0) return null
  const first = spans[0]
  const last = spans[spans.length - 1]
  if (!first || !last) return null
  let keepStart = -1
  let keepEnd = -1
  let edge: 'start' | 'end' | null = null
  if (normalizeWatermarkText(first.text) === token) {
    keepStart = first.end
    keepEnd = block.content.length
    edge = 'start'
  } else if (normalizeWatermarkText(last.text) === token) {
    keepStart = 0
    keepEnd = last.start
    edge = 'end'
  } else {
    return null
  }
  const raw = block.content.slice(keepStart, keepEnd)
  if (raw === block.content) return null
  // 与水印相邻的分隔空白一并带走，保持入库正文干净；整块/余空不补丁
  const after = raw.trim()
  if (after.length === 0) return null
  return {
    id: block.id,
    action: 'update',
    before: block.content,
    after,
    reason: `custom-edge-${edge}:${token}`,
    pageNumber: block.pageNumber,
  }
}

function planOne(
  block: BodyBlockInput,
  customToken: string | null,
  activeWholeBlockSet: ReadonlySet<string>,
  activeTrimSet: ReadonlySet<string>,
  attachedPrefix: string | null,
): BodyWatermarkPatch | null {
  if (block.type === 'table') return null
  if (block.content.trim().length === 0) return null
  const norm = normalizeWatermarkText(block.content)
  if (norm.length === 0) return null
  if (activeWholeBlockSet.has(norm)) {
    return {
      id: block.id,
      action: 'delete',
      before: block.content,
      reason: `whole-block:${norm}`,
      pageNumber: block.pageNumber,
    }
  }
  const spans = splitTokenSpans(block.content)
  if (spans.length === 0) return null
  let start = 0
  let end = spans.length
  const stripped: string[] = []
  while (start < end) {
    const key = normalizeWatermarkText(spans[start]?.text ?? '')
    if (!activeTrimSet.has(key)) break
    stripped.push(key)
    start += 1
  }
  while (end > start) {
    const key = normalizeWatermarkText(spans[end - 1]?.text ?? '')
    if (!activeTrimSet.has(key)) break
    stripped.push(key)
    end -= 1
  }
  if (stripped.length === 0) {
    // fallback 顺序：narrow 未命中才试自定义；内置优先，单块单补丁
    return (
      planAttachedStart(block, attachedPrefix) ??
      (customToken ? planCustomEdge(block, customToken) : null)
    )
  }
  if (start >= end) {
    // 整块全由水印 token 组成：删块，不留空串
    return {
      id: block.id,
      action: 'delete',
      before: block.content,
      reason: `trim-to-empty:${[...new Set(stripped)].join('+')}`,
      pageNumber: block.pageNumber,
    }
  }
  const first = spans[start]
  const last = spans[end - 1]
  if (!first || !last) return null
  const after = block.content.slice(first.start, last.end)
  if (after === block.content || after.trim().length === 0) return null
  // 修剪残留本身仍是整块水印：直接删块，不留碎片
  if (activeWholeBlockSet.has(normalizeWatermarkText(after))) {
    return {
      id: block.id,
      action: 'delete',
      before: block.content,
      reason: `trim-then-whole:${[...new Set(stripped)].join('+')}>${normalizeWatermarkText(after)}`,
      pageNumber: block.pageNumber,
    }
  }
  return {
    id: block.id,
    action: 'update',
    before: block.content,
    after,
    reason: `trim-edge:${[...new Set(stripped)].join('+')}`,
    pageNumber: block.pageNumber,
  }
}

/** 既有 blocks → 补丁提案（输入顺序即输出顺序，不重排 block_index） */
export function planBodyWatermarkPatches(
  blocks: readonly BodyBlockInput[],
  options?: BodyWatermarkPlanOptions,
): BodyWatermarkPatch[] {
  // 自定义 token 预校验一次：非法等价于未传（调用方应先用 validateCustomEdgeToken 提示）
  const validated =
    options && 'customEdgeToken' in options ? validateCustomEdgeToken(options.customEdgeToken) : null
  const customToken = validated && validated.ok ? validated.token : null

  const activeWholeBlockSet = options?.wholeBlockWatermarks
    ? new Set(options.wholeBlockWatermarks.map(normalizeWatermarkText))
    : wholeBlockSet
  const activeTrimSet = options?.trimWatermarks
    ? new Set(options.trimWatermarks.map(normalizeWatermarkText))
    : trimSet
  const attachedPrefix =
    options?.attachedStartPrefix !== undefined
      ? options.attachedStartPrefix
      : NARROW_ATTACHED_START_PREFIX

  const patches: BodyWatermarkPatch[] = []
  for (const block of blocks) {
    const patch = planOne(block, customToken, activeWholeBlockSet, activeTrimSet, attachedPrefix)
    if (patch) patches.push(patch)
  }
  return patches
}

const PLAN_SIGNATURE_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]

/**
 * 纯 JS SHA-256（UTF-8，十六进制小写），与 Node `createHash('sha256')` 同值。
 * 放 shared 供主/渲染两端复用：渲染进程无 node:crypto，不能 import node 模块。
 */
export function sha256HexAscii(input: string): string {
  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  const paddedLen = ((bytes.length + 9 + 63) >> 6) << 6
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(paddedLen - 4, bitLen >>> 0)
  const w = new Uint32Array(64)
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3)
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + (s0 >>> 0) + w[i - 7] + (s1 >>> 0)) | 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let hh = h7
    for (let i = 0; i < 64; i += 1) {
      const s1 =
        ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + (s1 >>> 0) + (ch >>> 0) + PLAN_SIGNATURE_K[i]! + w[i]!) | 0
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = ((s0 >>> 0) + (maj >>> 0)) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + hh) | 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('')
}

/**
 * 补丁计划确定性签名（Phase 2.3 应用守卫）。
 * 按 (id, action, before, after ?? '', reason) 排序后，对
 * `[[id, action, before, after ?? '', reason], ...]` 做 JSON 稳定序列化再 SHA-256。
 * 空计划签名即 sha256("[]")；排序保证输入顺序不同仍同签名。
 */
export function computeBodyWatermarkPlanSignature(
  patches: readonly BodyWatermarkPatch[],
): string {
  const sorted = [...patches].sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id
    if (a.action !== b.action) return a.action < b.action ? -1 : 1
    if (a.before !== b.before) return a.before < b.before ? -1 : 1
    const aAfter = a.after ?? ''
    const bAfter = b.after ?? ''
    if (aAfter !== bAfter) return aAfter < bAfter ? -1 : 1
    if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1
    return 0
  })
  const canonical = JSON.stringify(
    sorted.map((p) => [p.id, p.action, p.before, p.after ?? '', p.reason]),
  )
  return sha256HexAscii(canonical)
}
