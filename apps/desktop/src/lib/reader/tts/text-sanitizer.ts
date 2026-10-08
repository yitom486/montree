export interface SentenceItem {
  id: string
  index: number
  text: string
  rawSentence: string
  charCount: number
  weight: number
  startTime: number
  endTime: number
  cleanText?: string
  isParagraphEnd?: boolean
  /** 句末检测到的真实物理停顿时长（秒） */
  detectedPauseSec?: number
  /** 声学对齐标记类型：物理停顿锚定 | 比例插值 */
  alignmentType?: 'acoustic-vad' | 'proportional'
}

export interface SanitizedTextResult {
  fullCleanText: string
  sentences: SentenceItem[]
}

export interface SanitizeReaderOptions {
  /** 智能过滤角标与注释序号（如 (5), [1], ①, 脚注[^1] 等），默认 true */
  filterFootnotesAndCitations?: boolean
  /** 智能过滤纯链接与技术排版符（如 URL、代码块、Markdown 标记等），默认 true */
  filterLinksAndTechnicalMarkup?: boolean
}

/**
 * 智能文本降噪清洗器：
 * 1. 过滤链接 URL，只保留正文内容和链接引用的锚文本；
 * 2. 彻底去除角标数字（如 (5), [1], ①, ¹²³, 脚注 [^1] 等），保留正文语义括注（如「(中康熙壬辰科武探花)」）；
 * 3. 滤除 Markdown/HTML 杂音符号（标题符号、图片链接、粗体标记、分割线等），保留纯粹自然语言流；
 * 4. 自动修复角标清除后的标点粘连与多余空白。
 */
export function sanitizeReaderText(
  raw: string,
  options: SanitizeReaderOptions = {},
): SanitizedTextResult {
  if (!raw || !raw.trim()) {
    return { fullCleanText: '', sentences: [] }
  }

  const filterCitations = options.filterFootnotesAndCitations !== false
  const filterMarkup = options.filterLinksAndTechnicalMarkup !== false

  let text = raw.replace(/\r\n/g, '\n')

  if (filterMarkup) {
    // 1. 去除代码块（``` ... ```）
    text = text.replace(/```[\s\S]*?```/g, '')

    // 2. 处理图片：去除 ![alt](url)，不朗读图片
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')

    // 3. 处理 Markdown 链接：保留 [正文文字](url) 中的「正文文字」，剔除 URL
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

    // 4. 处理 HTML 链接：保留 <a href="...">正文文字</a> 中的「正文文字」
    text = text.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')

    // 5. 去除裸 URL 与尖括号 URL（http:// 或 https:// 或 www. 开头的纯链接）
    text = text.replace(/<https?:\/\/[^>]+>/gi, '')
    text = text.replace(/https?:\/\/[^\s<>()]+/gi, '')
    text = text.replace(/(^|[\s(（])www\.[a-z0-9\-]+(?:\.[a-z0-9\-]+)*(?:\/[^\s<>()]*)?/gi, '$1')
  }

  if (filterCitations) {
    // 6. 去除 HTML 上标角标标签及内容（如 <sup>5</sup>, <sup><a ...>5</a></sup>）
    text = text.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')

    // 7. 去除 Markdown 脚注定义整行（如 [^1]: 某某参考资料）
    text = text.replace(/^\[\^[^\]]+\]:.*$/gm, '')

    // 8. 去除 Markdown 脚注引用（如 [^1]）
    text = text.replace(/\[\^[^\]]+\]/g, '')

    // 9. 去除方括号/六角括号/黑括号数字角标与注释引用（如 [1], [2], [12], [1-3], [1, 2], [注 1], [注1], [参 1], [ref 1], 【1】, 〔1〕）
    text = text.replace(/[\[〔【〖](?:\d+|[注参]\s*\d+|ref:\s*\d+|note:\s*\d+)(?:[-–—,~、，,\s]*\d+)*[\]〕】〗]/gi, '')

    // 10. 去除半角与全角圆括号纯数字角标与带“注/参/ref”的角标（如 (5), (6), （5）, （6）, (1-3), (注1), （注 1）, (ref 2)）
    // 注意：正文夹注（如「(中康熙壬辰科武探花)」或「（北京大学教授）」）包含文字，不在此正则范围内，会被完整安全保留！
    text = text.replace(/[（\(](?:\d+|[注参]\s*\d+|ref:\s*\d+|note:\s*\d+)(?:[-–—,~、，,\s]*\d+)*[）\)]/gi, '')

    // 11. 去除带圈数字与序数符号（① ~ ⑳, ⑴ ~ ⒇, ⒈ ~ ⒛, ㉑ ~ ㉟）
    text = text.replace(/[\u2460-\u2473\u2474-\u2487\u2488-\u249B\u3251-\u325F\u32B1-\u32BF]/g, '')

    // 12. 去除 Unicode 上标/下标数字与符号（¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁰ ⁺ ⁻ ⁽¹⁾ ₁ ₂ 等）
    text = text.replace(/[\u00B9\u00B2\u00B3\u2070-\u207F\u207A\u207B\u2080-\u208E]+/g, '')

    // 13. 去除维基/书籍常见注释回跳符号（↑, ↩, ↳）
    text = text.replace(/[↑↩↳]/g, '')
  }

  if (filterMarkup) {
    // 14. 处理 HTML 块级与换行标签，转换为真实自然段落分隔
    text = text.replace(/<\/(p|div|section|article|h[1-6]|li)>/gi, '\n\n')
    text = text.replace(/<(br|hr)\s*\/?>/gi, '\n')
    // 去除其他 HTML 标签
    text = text.replace(/<[^>]+>/g, '')

    // 15. 去除 Markdown 格式标记
    // 行内代码 `code` -> code
    text = text.replace(/`([^`]+)`/g, '$1')
    // 粗体/斜体 **text** / *text* / __text__ / _text_
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
    text = text.replace(/(\*|_)(.*?)\1/g, '$2')
    // 删除线 ~~text~~
    text = text.replace(/~~(.*?)~~/g, '$1')
    // 标题符 # ## ###
    text = text.replace(/^#{1,6}\s+/gm, '')
    // 引用符 >
    text = text.replace(/^>\s+/gm, '')
    // 分割线 --- ***
    text = text.replace(/^[-*_]{3,}\s*$/gm, '')
    // 表格边框与分隔行
    text = text.replace(/^\|?[-:\s|]+\|?$/gm, '')
    text = text.replace(/\|/g, ' ')
  }

  // 16. 标点粘连与多余空白自愈修复：
  // 若角标被删后，标点（如逗号、句号）前面留下了多余空格，自动消除紧贴前面引号或字符
  text = text.replace(/([“"”’'\p{L}\p{N}])\s+([，。！？；、,.!?;:])/gu, '$1$2')
  // 消除可能由过滤产生的连续重复逗号/顿号（如 ，， -> ，）
  text = text.replace(/([，,]){2,}/g, '$1')
  text = text.replace(/([、、]){2,}/g, '、')
  // 汉字与中文引号语境下的半角逗号智能规范为全角逗号（提供更自然准确的 TTS 停顿韵律）
  text = text.replace(/([\p{Script=Han}”’」』）\)])\s*,\s*([\p{Script=Han}“‘「『（\(])/gu, '$1，$2')

  // 17. 清理多余空行与水平空白
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n').trim()

  if (!text) {
    return { fullCleanText: '', sentences: [] }
  }

  // 18. 按自然段落切分，并在段落内精准分句，保持段落自然韵律与完整性
  const rawParagraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const sentences: SentenceItem[] = []
  const cleanParagraphs: string[] = []

  let idx = 0
  for (const para of rawParagraphs) {
    const paraSegments = splitIntoSentences(para)
    const paraCleanSentences: string[] = []
    for (let sIdx = 0; sIdx < paraSegments.length; sIdx++) {
      const seg = paraSegments[sIdx]
      const trimmed = seg.trim()
      if (!trimmed) continue
      const charCount = trimmed.length
      // 计算停顿加权：中英文基本字数 + 标点停顿权重
      const pauseBonus = /[。！？!?]/.test(trimmed) ? 2 : /[；;，,]/.test(trimmed) ? 1 : 0.5
      const weight = Math.max(1, charCount + pauseBonus * 2)
      const isParagraphEnd = sIdx === paraSegments.length - 1

      sentences.push({
        id: `tts-s-${idx}`,
        index: idx,
        text: trimmed,
        rawSentence: seg,
        charCount,
        weight,
        startTime: 0,
        endTime: 0,
        isParagraphEnd,
      })
      paraCleanSentences.push(trimmed)
      idx++
    }

    if (paraCleanSentences.length > 0) {
      // 段落内自然连接：中文/全角标点直接无缝相接，西文/英文单词间保留一个空格
      let joinedPara = ''
      for (let i = 0; i < paraCleanSentences.length; i++) {
        const cur = paraCleanSentences[i]
        if (i === 0) {
          joinedPara = cur
        } else {
          const prev = paraCleanSentences[i - 1]
          const needsSpace = /[a-zA-Z0-9,.!?:;]$/.test(prev) && /^[a-zA-Z0-9]/.test(cur)
          joinedPara += (needsSpace ? ' ' : '') + cur
        }
      }
      cleanParagraphs.push(joinedPara)
    }
  }

  const fullCleanText = cleanParagraphs.join('\n\n')
  return { fullCleanText, sentences }
}

/**
 * 自然语言分句器：
 * 保留句末标点，按中文标点（。！？；）、英文标点（. ! ? 后跟空白）及换行切分。
 */
function splitIntoSentences(text: string): string[] {
  const result: string[] = []
  let buffer = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    buffer += char

    if (char === '\n') {
      if (buffer.trim()) result.push(buffer.trim())
      buffer = ''
      continue
    }

    // 中文句末标点：。 ！？ ；
    if (char === '。' || char === '！' || char === '？' || char === '；' || char === '…') {
      // 查看下一个字符是否是右引号/右括号
      const next = text[i + 1]
      if (next === '”' || next === '’' || next === '」' || next === '）' || next === '"') {
        buffer += next
        i++
      }
      if (buffer.trim()) result.push(buffer.trim())
      buffer = ''
      continue
    }

    // 英文句末标点：. ! ? 且后跟空白或行尾
    if (char === '.' || char === '!' || char === '?') {
      const next = text[i + 1]
      // 避免把浮点数或缩写误判为句末
      if (!next || /\s/.test(next)) {
        if (buffer.trim()) result.push(buffer.trim())
        buffer = ''
      }
    }
  }

  if (buffer.trim()) {
    result.push(buffer.trim())
  }

  return result
}

/**
 * 根据音频总时长分配各句子的起止时间戳：
 * 基于句子字数与标点停顿权重进行平滑加权插值。
 */
export function allocateSentenceTimeline(
  sentences: SentenceItem[],
  totalDurationSeconds: number,
): SentenceItem[] {
  if (sentences.length === 0 || totalDurationSeconds <= 0) return sentences

  // 客观字符规模比例插值：不人为硬编码任何固定停顿常数，由真实字符比例确定基准区间
  const charCounts = sentences.map((s) => Math.max(1, (s.cleanText ?? s.text ?? '').length))
  const totalChars = charCounts.reduce((sum, c) => sum + c, 0)
  if (totalChars <= 0) return sentences

  let currentTime = 0
  return sentences.map((s, idx) => {
    const fraction = charCounts[idx] / totalChars
    const duration = fraction * totalDurationSeconds
    const startTime = currentTime
    const endTime = idx === sentences.length - 1 ? totalDurationSeconds : currentTime + duration
    currentTime = endTime

    return {
      ...s,
      startTime,
      endTime,
    }
  })
}

/**
 * 根据当前播放时间（秒）定位正在朗读的句子：
 * 具备声学时间轴容差吸附与流式未对齐阶段的平滑语速推算，避免突兀跳至末尾。
 */
export function findCurrentSentenceIndex(
  sentences: SentenceItem[],
  currentTimeSeconds: number,
): number {
  if (sentences.length === 0) return -1
  if (currentTimeSeconds <= 0) return 0

  // 1. 判断是否已具备有效的时间轴区间
  const hasValidTimeline = sentences.some((s) => s.endTime !== undefined && s.endTime > (s.startTime ?? 0))

  if (hasValidTimeline) {
    if (currentTimeSeconds <= (sentences[0].startTime ?? 0)) return 0
    const last = sentences[sentences.length - 1]
    if (currentTimeSeconds >= (last.endTime ?? 0)) return sentences.length - 1

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i]
      const start = s.startTime ?? 0
      const end = s.endTime ?? start
      if (currentTimeSeconds >= start && currentTimeSeconds <= end) {
        return i
      }
      if (currentTimeSeconds < start) {
        return Math.max(0, i - 1)
      }
    }
    return sentences.length - 1
  }

  // 2. 流式接收或对齐未完成阶段：基于大模型真实平均语速（~4.5 字/秒 + 真实短停顿）平滑推算当前句
  let accumulatedSeconds = 0
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    const textLen = (s.cleanText ?? s.text ?? '').length
    const pauseSec = s.isParagraphEnd ? 0.35 : /[。！？!?]$/.test((s.text ?? '').trim()) ? 0.25 : 0.1
    const estSec = Math.max(0.2, textLen / 4.5 + pauseSec)
    accumulatedSeconds += estSec
    if (currentTimeSeconds <= accumulatedSeconds) {
      return i
    }
  }

  return sentences.length - 1
}

/**
 * 寻找与视口文本最匹配的起始句子索引：
 * 当用户翻到章节中间或某一页时点击听书，优先从视口最顶部的句子开始朗读。
 */
export function findViewportStartingSentenceIndex(
  sentences: SentenceItem[],
  viewportText: string,
): number {
  if (!viewportText || !viewportText.trim() || sentences.length === 0) {
    return 0
  }

  // 1. 规范化视口文本：去除多余空白和换行
  const cleanViewport = viewportText.replace(/\s+/g, ' ').trim()
  if (!cleanViewport) return 0

  // 提取视口前 40 个非空字符
  const compactViewport = cleanViewport.replace(/[\s\p{P}]/gu, '')
  if (!compactViewport) return 0

  const viewportHead = compactViewport.slice(0, 16)

  // 2. 第一轮：前缀/字串特征精确命中
  for (let i = 0; i < sentences.length; i++) {
    const compactSentence = sentences[i].text.replace(/[\s\p{P}]/gu, '')
    if (!compactSentence) continue

    // 句子开头包含视口头部，或者视口头部包含句子开头
    if (compactSentence.startsWith(viewportHead) || viewportHead.startsWith(compactSentence.slice(0, 10))) {
      return i
    }
    if (compactSentence.includes(viewportHead) || (viewportHead.length >= 8 && compactSentence.includes(viewportHead.slice(0, 8)))) {
      return i
    }
  }

  // 3. 第二轮：子串包含度匹配（视口文本通常包含当前屏的第一整句）
  for (let i = 0; i < sentences.length; i++) {
    const compactSentence = sentences[i].text.replace(/[\s\p{P}]/gu, '')
    if (compactSentence.length >= 6) {
      const probe = compactSentence.slice(0, 10)
      if (compactViewport.startsWith(probe) || compactViewport.slice(0, 30).includes(probe)) {
        return i
      }
    }
  }

  return 0
}
