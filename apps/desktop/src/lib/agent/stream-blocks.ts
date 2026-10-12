/**
 * 流式 Markdown 稳定块切分（纯函数）：把原文切成“冻结头 + 活动尾”，
 * 让每帧解析量从 O(全文) 降到 O(尾部)，总工作量从 O(n²) 降到近似 O(n)。
 *
 * - 切点只取围栏闭合处的空行：围栏（``` / ~~~，含未闭合）永不撕裂；
 * - 表格天然无空行，不会被切开；标题/段落天然安全；
 * - 含脚注引用（`[^x]`）时回退整文单解析：引用与定义跨切点无法同解析，
 *   此时保持旧行为（不回归、只不加速）；
 * - 列表/引用若正好跨切点，会渲染成两个相邻块（间距稍大，不断裂、不丢字）；
 * - 尾部上限（默认 4000 字）：超长无空行段向前找切点，找不到才放行
 *   （病态单行围栏，实践中不存在）。
 *
 * 逐 chunk 全文扫描一次（纯字符比较，相对解析可忽略）， expensive 的
 * mdast/hast/React/KaTeX 只发生在：头（随段落到达，低频）+ 尾（有界，每帧）。
 */
export interface StreamSplit {
  head: string
  tail: string
  /** true = 回退整文单解析（head 为全文，tail 为空） */
  fallbackFull: boolean
}

export const STREAM_TAIL_CAP = 4000

const FOOTNOTE_REF_RE = /\[\^[^\]\n]+\]/
const BLANK_RE = /^[ \t]*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

interface FenceState {
  marker: '`' | '~'
  length: number
}

function fenceOf(line: string, open: FenceState | null): FenceState | null {
  const match = FENCE_RE.exec(line)
  if (!match) return open
  const seq = match[1]!
  const marker = seq[0] as '`' | '~'
  if (!open) return { marker, length: seq.length }
  // 闭合：同字符且长度不小于 opening，行内无其他内容（info 串只允许 opening 行）
  if (marker === open.marker && seq.length >= open.length) return null
  return open
}

export function splitStreamText(text: string, tailCap = STREAM_TAIL_CAP): StreamSplit {
  if (!text) return { head: '', tail: '', fallbackFull: false }
  if (FOOTNOTE_REF_RE.test(text)) {
    // 脚注引用与定义必须同解析：回退整文单解析（head 为空，只渲染 tail）。
    return { head: '', tail: text, fallbackFull: true }
  }
  const lines = text.split('\n')
  // 围栏状态逐行推进（相对解析可忽略的纯字符扫描）
  const openAt: Array<FenceState | null> = new Array(lines.length)
  let open: FenceState | null = null
  for (let i = 0; i < lines.length; i += 1) {
    open = fenceOf(lines[i]!, open)
    openAt[i] = open
  }
  const isBlank = (i: number): boolean => BLANK_RE.test(lines[i] ?? '')
  const closedAt = (i: number): boolean => openAt[i] == null
  // 行首字符偏移（行号↔字符数换算）
  const lineStartChar: number[] = new Array(lines.length)
  let acc = 0
  for (let i = 0; i < lines.length; i += 1) {
    lineStartChar[i] = acc
    acc += lines[i]!.length + 1
  }

  // 首选切点：最后一个“围栏闭合处”的空行
  let cut = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isBlank(i) && closedAt(i)) {
      cut = i
      break
    }
  }
  let headEndChar = cut < 0 ? 0 : lineStartChar[cut]!
  // 尾部超限：从 cap 边界向前找第一个可用切点；
  // 边界后无空行时退回首选切点（总比整文尾好），都没有才放行。
  if (text.length - headEndChar > tailCap) {
    let found = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (lineStartChar[i]! < text.length - tailCap) continue
      if (isBlank(i) && closedAt(i)) {
        found = lineStartChar[i]!
        break
      }
    }
    headEndChar = found >= 0 ? found : cut < 0 ? 0 : lineStartChar[cut]!
  }
  if (headEndChar <= 0) return { head: '', tail: text, fallbackFull: false }
  // head 吞掉切点处的连续空行，tail 从有效内容开始
  let tailStartChar = headEndChar
  while (tailStartChar < text.length && (text[tailStartChar] === '\n' || text[tailStartChar] === ' ' || text[tailStartChar] === '\t' || text[tailStartChar] === '\r')) {
    tailStartChar += 1
  }
  return {
    head: text.slice(0, headEndChar).replace(/[ \t\r\n]+$/, ''),
    tail: text.slice(tailStartChar),
    fallbackFull: false,
  }
}
