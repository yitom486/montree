/**
 * YAML Frontmatter 识别与展示用解析。
 *
 * 只处理文档首行 `---` / 结尾 `---`（或 `...`）的常见站点格式，不做完整 YAML
 * 解析：预览需要整段省略，所见即所得需要把顶层 `key: value` 转成属性卡片。
 */

export interface FrontmatterEntry {
  key: string
  value: string
}

export interface FrontmatterBlock {
  /** 原始文本（含首尾分隔线） */
  raw: string
  /** 含分隔线在内的行数（0-based 结束行 + 1） */
  lineCount: number
  entries: FrontmatterEntry[]
}

const OPEN_DELIMITER = /^---[ \t]*$/
const CLOSE_DELIMITER = /^(?:---|\.\.\.)[ \t]*$/
const PROPERTY_LINE = /^[A-Za-z0-9_.-]+\s*:/

function isYamlLine(line: string): boolean {
  // 空行、注释、缩进续行（数组/多行字符串）都属于合法 YAML 片段；
  // 非缩进内容必须是 `key:` 或列表项，否则视为普通 Markdown 的 hr 区块。
  return /^\s*(?:#.*)?$/.test(line) || /^\s+/.test(line) || /^-\s+/.test(line) || PROPERTY_LINE.test(line)
}

function splitLines(source: string): string[] {
  return source.split(/\r?\n/)
}

function findFrontmatterLines(source: string): { lines: string[]; end: number } | null {
  const lines = splitLines(source)
  const first = (lines[0] ?? '').replace(/^\uFEFF/, '')
  if (!OPEN_DELIMITER.test(first)) return null

  let propertyCount = 0
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!
    if (CLOSE_DELIMITER.test(line)) {
      if (index === 1 || propertyCount === 0) return null
      return { lines, end: index }
    }
    if (!isYamlLine(line)) return null
    if (PROPERTY_LINE.test(line)) propertyCount += 1
  }

  return null
}

function decodeQuotedValue(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replace(/\\U([0-9a-fA-F]{8})/g, (_match, hex: string) => {
        try {
          return String.fromCodePoint(Number.parseInt(hex, 16))
        } catch {
          return _match
        }
      })
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

/** 从 frontmatter 正文行中抽取顶层属性；缩进续行拼接到上一个属性。 */
export function parseFrontmatterEntries(lines: string[]): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = []
  let current: FrontmatterEntry | undefined

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (match) {
      current = { key: match[1]!, value: decodeQuotedValue(match[2] ?? '') }
      entries.push(current)
      continue
    }
    if (current && /^\s+/.test(line)) {
      const continuation = line.trim()
      current.value = current.value ? `${current.value} ${continuation}` : continuation
    }
  }

  return entries
}

export function readFrontmatter(source: string): FrontmatterBlock | null {
  const found = findFrontmatterLines(source)
  if (!found) return null
  const { lines, end } = found
  return {
    raw: lines.slice(0, end + 1).join('\n'),
    lineCount: end + 1,
    entries: parseFrontmatterEntries(lines.slice(1, end)),
  }
}

/**
 * 将 frontmatter 替换为等量空行，保留正文行号（大纲、源码映射依赖行索引）。
 */
export function stripFrontmatter(source: string): string {
  const frontmatter = readFrontmatter(source)
  if (!frontmatter) return source
  const lines = splitLines(source)
  return [...Array<string>(frontmatter.lineCount).fill(''), ...lines.slice(frontmatter.lineCount)].join('\n')
}

export function frontmatterField(entries: FrontmatterEntry[], key: string): string | undefined {
  return entries.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value
}
