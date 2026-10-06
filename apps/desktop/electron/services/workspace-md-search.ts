import { readdirSync, readFileSync, realpathSync, statSync, type Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { assertInsideWorkspace } from './workspace-fs'

/**
 * 工作区 Markdown 字面检索（P2.2，只读）。
 *
 * 硬边界：
 * - root 由调用方（渲染端文件树状态）给出，模型碰不到；每个候选仍过
 *   assertInsideWorkspace，且用 realpath 防 symlink 逃出根；
 * - 只认 .md / .markdown（大小写不敏感）；跳过点开头目录/文件、
 *   node_modules、.git、.montree、dist、out、release；
 * - 字面匹配（toLowerCase + includes），无正则、无 shell、无 spawn；
 * - 最多读 200 文件、单文件 256KB（超则跳过）、内部命中最多 100 条；
 * - 单文件超时/异常只跳过该文件，永不整次失败；只读不写。
 */

export interface WorkspaceMarkdownHit {
  /** 相对根的 posix 相对路径（正斜杠，永不绝对路径/盘符） */
  filePath: string
  /** 1-based 行号 */
  lineStart: number
  /** 命中行原文（至多 2000 字，调用方再按预算开窗） */
  line: string
}

export interface WorkspaceMarkdownResult {
  /** 精确命中数（文件×行，去重后，上限 100） */
  total: number
  hits: WorkspaceMarkdownHit[]
}

export const WORKSPACE_MD_MAX_FILES = 200
export const WORKSPACE_MD_MAX_FILE_BYTES = 256 * 1024
export const WORKSPACE_MD_MAX_HITS = 100
export const WORKSPACE_MD_MAX_LINE_CHARS = 2000

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.montree', 'dist', 'out', 'release'])

function isMarkdownFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return MARKDOWN_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

function toPosixRelative(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

/**
 * 根内列文件（深度优先，相对路径排序保证确定性）。
 * excludeAbs：当前打开文件的磁盘路径（已解析），命中即跳过整文件。
 */
function listMarkdownFiles(root: string, excludeAbs: string | null): string[] {
  const collected: string[] = []
  const stack: string[] = [root]
  while (stack.length > 0 && collected.length < WORKSPACE_MD_MAX_FILES) {
    const dir = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const names = entries.map((entry) => entry.name).sort()
    for (const name of names) {
      if (collected.length >= WORKSPACE_MD_MAX_FILES) break
      if (name.startsWith('.')) continue
      const abs = join(dir, name)
      const entry = entries.find((item) => item.name === name)
      if (!entry) continue
      try {
        // symlink 一律跳过（含根内链接）：比“仅跳逃逸”更严，免循环与竞态
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (SKIP_DIRECTORIES.has(name)) continue
          stack.push(abs)
        } else if (entry.isFile() && isMarkdownFile(name)) {
          if (excludeAbs !== null) {
            try {
              if (realpathSync(abs) === excludeAbs) continue
            } catch {
              continue
            }
          }
          collected.push(abs)
        }
      } catch {
        continue
      }
    }
  }
  return collected.sort()
}

function searchFile(abs: string, needle: string, hits: WorkspaceMarkdownHit[], rel: string): void {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(abs)
  } catch {
    return
  }
  if (!stat.isFile() || stat.size > WORKSPACE_MD_MAX_FILE_BYTES) return
  let raw: string
  try {
    raw = readFileSync(abs, 'utf8')
  } catch {
    return
  }
  const lines = raw.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (hits.length >= WORKSPACE_MD_MAX_HITS) return
    const line = lines[index] ?? ''
    if (line.toLowerCase().includes(needle)) {
      hits.push({
        filePath: rel,
        lineStart: index + 1,
        line: line.length > WORKSPACE_MD_MAX_LINE_CHARS ? line.slice(0, WORKSPACE_MD_MAX_LINE_CHARS) : line,
      })
    }
  }
}

export interface SearchWorkspaceMarkdownInput {
  /** 工作区根（渲染端文件树状态；主进程仍逐文件 assert） */
  root: string
  /** 已校验的字面检索词（非空；长度规则由调用方先拒） */
  query: string
  /** 当前打开文件的磁盘路径（跳过其磁盘副本；内存已覆盖） */
  excludePath?: string | null
}

export function searchWorkspaceMarkdown(input: SearchWorkspaceMarkdownInput): WorkspaceMarkdownResult {
  const hits: WorkspaceMarkdownHit[] = []
  // root 仅做解析（来源由调用方文件树状态保证，模型碰不到）；逐文件仍 assert
  let root: string
  try {
    root = resolve(input.root)
  } catch {
    return { total: 0, hits }
  }
  const needle = input.query.toLowerCase()
  if (!needle) return { total: 0, hits }
  let excludeAbs: string | null = null
  if (typeof input.excludePath === 'string' && input.excludePath) {
    try {
      const resolved = assertInsideWorkspace(input.excludePath, root)
      excludeAbs = realpathSync(resolved)
    } catch {
      excludeAbs = null
    }
  }
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return { total: 0, hits }
  }
  const files = listMarkdownFiles(realRoot, excludeAbs)
  for (const abs of files) {
    if (hits.length >= WORKSPACE_MD_MAX_HITS) break
    // 双保险：realpath 后再确认仍在根内（symlink 逃逸至此必不符）
    let real: string
    try {
      real = realpathSync(abs)
    } catch {
      continue
    }
    const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep
    if (real !== realRoot && !real.startsWith(rootWithSep)) continue
    searchFile(abs, needle, hits, toPosixRelative(realRoot, real))
  }
  return { total: hits.length, hits }
}
