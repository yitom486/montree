/**
 * 高性能日志流解析与分析模型
 * 支持日志等级自动推断（ERROR/WARN/INFO/DEBUG/TRACE）、时间戳与模块名提取、
 * 堆栈多行跟踪吸附、级别统计、多维度模糊/正则过滤与导出。
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'unknown'

export interface LogEntry {
  lineIndex: number
  rawText: string
  level: LogLevel
  timestamp?: string
  module?: string
  message: string
  isStackTrace: boolean
}

export interface LogFilterOptions {
  levels?: LogLevel[]
  searchQuery?: string
  isRegex?: boolean
  caseSensitive?: boolean
}

export interface LogStats {
  totalLines: number
  errorCount: number
  warnCount: number
  infoCount: number
  debugCount: number
  traceCount: number
}

const LOG_LEVEL_REGEX = /\b(FATAL|ERROR|SEVERE|ERR|WARN|WARNING|INFO|NOTICE|DEBUG|TRACE)\b/i
const TIMESTAMP_REGEX = /(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?|\b\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\b)/
const MODULE_REGEX = /\[([^[\]]+)\]|\(([()]+)\)/

export class LogDataset {
  private _entries: LogEntry[]

  constructor(entries: LogEntry[] = []) {
    this._entries = [...entries]
  }

  get entries(): readonly LogEntry[] {
    return this._entries
  }

  get totalCount(): number {
    return this._entries.length
  }

  getStats(): LogStats {
    let errorCount = 0
    let warnCount = 0
    let infoCount = 0
    let debugCount = 0
    let traceCount = 0

    for (const entry of this._entries) {
      switch (entry.level) {
        case 'error':
          errorCount++
          break
        case 'warn':
          warnCount++
          break
        case 'info':
          infoCount++
          break
        case 'debug':
          debugCount++
          break
        case 'trace':
          traceCount++
          break
      }
    }

    return {
      totalLines: this._entries.length,
      errorCount,
      warnCount,
      infoCount,
      debugCount,
      traceCount,
    }
  }

  /**
   * 过滤日志流
   */
  filter(options: LogFilterOptions): LogEntry[] {
    const levelSet = options.levels && options.levels.length > 0 ? new Set(options.levels) : null
    const query = options.searchQuery?.trim() ?? ''

    let regex: RegExp | null = null
    if (query) {
      try {
        regex = options.isRegex
          ? new RegExp(query, options.caseSensitive ? '' : 'i')
          : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? '' : 'i')
      } catch {
        // 无效正则回退为包含匹配
        regex = null
      }
    }

    return this._entries.filter((entry) => {
      if (levelSet && !levelSet.has(entry.level)) {
        return false
      }
      if (query) {
        if (regex) {
          return regex.test(entry.rawText)
        }
        const target = options.caseSensitive ? entry.rawText : entry.rawText.toLowerCase()
        const q = options.caseSensitive ? query : query.toLowerCase()
        return target.includes(q)
      }
      return true
    })
  }

  /**
   * 增：追加一条日志记录
   */
  appendLine(lineText: string): LogEntry {
    const nextIndex = this._entries.length + 1
    const prev = this._entries[this._entries.length - 1]
    const parsed = LogDataset.parseLine(lineText, nextIndex, prev)
    this._entries.push(parsed)
    return parsed
  }

  /**
   * 删：根据行号删除日志
   */
  deleteLine(lineIndex: number): boolean {
    const idx = this._entries.findIndex((e) => e.lineIndex === lineIndex)
    if (idx === -1) return false
    this._entries.splice(idx, 1)
    return true
  }

  /**
   * 改：修改特定行内容并重新推断元信息
   */
  updateLine(lineIndex: number, newText: string): boolean {
    const idx = this._entries.findIndex((e) => e.lineIndex === lineIndex)
    if (idx === -1) return false
    const prev = idx > 0 ? this._entries[idx - 1] : undefined
    this._entries[idx] = LogDataset.parseLine(newText, lineIndex, prev)
    return true
  }

  /**
   * 解析单行日志
   */
  static parseLine(rawLine: string, lineIndex: number, previousEntry?: LogEntry): LogEntry {
    const isIndentedStack = /^\s+(at\s+|Caused by:|nested:|\.\.\.\s+\d+\s+more)/.test(rawLine)
    const isExceptionLine = /^[a-zA-Z0-9_$.]+(Exception|Error):/.test(rawLine.trim())
    const hasTimestamp = TIMESTAMP_REGEX.test(rawLine)
    const hasLevel = LOG_LEVEL_REGEX.test(rawLine)

    const isStackTrace = isIndentedStack || (!hasTimestamp && !hasLevel && (isExceptionLine || Boolean(previousEntry?.isStackTrace)))

    // 堆栈跟踪与未打标签的异常续行默认继承上一行日志的元信息
    if (isStackTrace && previousEntry) {
      return {
        lineIndex,
        rawText: rawLine,
        level: previousEntry.level,
        timestamp: previousEntry.timestamp,
        module: previousEntry.module,
        message: rawLine.trim(),
        isStackTrace: true,
      }
    }

    // 1. 级别推断
    let level: LogLevel = 'unknown'
    const levelMatch = LOG_LEVEL_REGEX.exec(rawLine)
    if (levelMatch) {
      const tag = levelMatch[1].toUpperCase()
      if (tag === 'ERROR' || tag === 'FATAL' || tag === 'SEVERE' || tag === 'ERR') level = 'error'
      else if (tag === 'WARN' || tag === 'WARNING') level = 'warn'
      else if (tag === 'INFO' || tag === 'NOTICE') level = 'info'
      else if (tag === 'DEBUG') level = 'debug'
      else if (tag === 'TRACE') level = 'trace'
    }

    // 2. 时间戳提取
    let timestamp: string | undefined
    const timeMatch = TIMESTAMP_REGEX.exec(rawLine)
    if (timeMatch) {
      timestamp = timeMatch[1]
    }

    // 3. 模块名提取
    let moduleName: string | undefined
    const modMatch = MODULE_REGEX.exec(rawLine)
    if (modMatch) {
      moduleName = modMatch[1] ?? modMatch[2]
    }

    return {
      lineIndex,
      rawText: rawLine,
      level,
      timestamp,
      module: moduleName,
      message: rawLine.trim(),
      isStackTrace: false,
    }
  }

  /**
   * 解析完整日志文本
   */
  static parse(text: string): LogDataset {
    const lines = text.split(/\r?\n/)
    const entries: LogEntry[] = []
    let prev: LogEntry | undefined

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (i === lines.length - 1 && !line) continue // 忽略末尾空行
      const entry = LogDataset.parseLine(line, i + 1, prev)
      entries.push(entry)
      prev = entry
    }

    return new LogDataset(entries)
  }

  serialize(): string {
    return this._entries.map((e) => e.rawText).join('\n')
  }
}
