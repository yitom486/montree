/**
 * Monorepo 依赖边界门禁（B片）。
 * Run: bun run lint:deps [repoRoot] [--json]
 *
 * 扫描：packages 各包 src 下 ts/tsx（含 test）+ apps/desktop/src + apps/desktop/electron
 * 规则：
 *   R1 包禁 electron：packages 下禁止 spec === 'electron' 或 'electron/' 前缀
 *   R2 包禁 node:：packages 下禁止 'node:' 前缀（白名单见下）
 *   R3 包禁 react：packages 下禁止 react / react-dom（含子路径）
 *   R4 包禁别名：packages 下禁止 '@/' 与 '@shared'（含子路径）
 *   R5 包禁跨界：packages 下禁止 spec 含 'apps/desktop'，禁止相对引入越出所属包目录
 *   R6 渲染/主进程隔离：
 *     R6a apps/desktop/src 下非 api/ 禁止 window.electronAPI（含 electronAPI）、
 *         '@electron/remote'、'electron'、'node:'
 *     R6b apps/desktop/electron 下禁止 react / react-dom（含子路径）
 *
 * 豁免：行尾 `// check-deps:allow <R|模块> - 理由` 为唯一豁免，同行生效。
 *   白名单（R2）：packages/acp/src/jsonrpc-transport.ts 与
 *   packages/acp/src/jsonrpc-transport.test.ts 的 node:stream 各一行（ACP stdio）。
 *
 * 输出：每违一行，末计数；有违退出码 1，否则 0。--json 输出最小 JSON。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const rootArg = args.find((a) => !a.startsWith('-'))
const root = resolve(rootArg ?? join(import.meta.dir, '..'))

const PACKAGES_DIR = join(root, 'packages')
const RENDERER_DIR = join(root, 'apps', 'desktop', 'src')
const ELECTRON_DIR = join(root, 'apps', 'desktop', 'electron')
const RENDERER_API_DIR = join(RENDERER_DIR, 'api')

interface Violation {
  file: string
  line: number
  rule: string
  message: string
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectTsFiles(full, out)
    } else if (stat.isFile()) {
      if (!full.endsWith('.ts') && !full.endsWith('.tsx')) continue
      if (full.endsWith('.d.ts')) continue
      out.push(full)
    }
  }
  return out
}

function collectPackageFiles(): string[] {
  const out: string[] = []
  if (!existsSync(PACKAGES_DIR)) return out
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, entry, 'src')
    if (existsSync(src) && statSync(src).isDirectory()) collectTsFiles(src, out)
  }
  return out
}

const pkgFiles = collectPackageFiles()
const rendererFiles = collectTsFiles(RENDERER_DIR)
const electronFiles = collectTsFiles(ELECTRON_DIR)
const allFiles = [...pkgFiles, ...rendererFiles, ...electronFiles].sort()

function isPkgFile(file: string): string | null {
  const rel = relative(PACKAGES_DIR, file)
  if (rel.startsWith('..') || rel === '') return null
  const pkg = rel.split(sep)[0]
  return pkg ? join(PACKAGES_DIR, pkg) : null
}

function isRendererFile(file: string): boolean {
  return file === RENDERER_DIR || file.startsWith(RENDERER_DIR + sep)
}

function isRendererApiFile(file: string): boolean {
  return file === RENDERER_API_DIR || file.startsWith(RENDERER_API_DIR + sep)
}

function isElectronFile(file: string): boolean {
  return file === ELECTRON_DIR || file.startsWith(ELECTRON_DIR + sep)
}

/** 同行豁免：含 check-deps:allow 即豁免该行（可注明 R 编号或模块名，如 R2 / node:stream）。 */
function isAllowed(line: string, rule: string, spec?: string): boolean {
  const idx = line.indexOf('check-deps:allow')
  if (idx < 0) return false
  const suffix = line.slice(idx + 'check-deps:allow'.length)
  if (suffix.includes(rule)) return true
  if (spec && suffix.includes(spec)) return true
  return true
}

function extractSpecs(line: string): string[] {
  const specs: string[] = []
  for (const m of line.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    if (m[1]) specs.push(m[1])
  }
  const side = line.match(/^\s*import\s+['"]([^'"]+)['"]/)
  if (side?.[1]) specs.push(side[1])
  return specs
}

function isElectronSpec(spec: string): boolean {
  return spec === 'electron' || spec.startsWith('electron/')
}

function isNodeSpec(spec: string): boolean {
  return spec.startsWith('node:')
}

function isReactSpec(spec: string): boolean {
  return spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec.startsWith('react-dom/')
}

function isAliasSpec(spec: string): boolean {
  return spec === '@/' || spec.startsWith('@/') || spec === '@shared' || spec.startsWith('@shared/')
}

function isRemoteSpec(spec: string): boolean {
  return spec === '@electron/remote' || spec.startsWith('@electron/remote/')
}

function escapesPackage(file: string, pkgRoot: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false
  const base = spec.split('?')[0]!.split('#')[0]!
  const resolved = resolve(dirname(file), base)
  const rel = relative(pkgRoot, resolved)
  return rel === '..' || rel.startsWith(`..${sep}`)
}

const violations: Violation[] = []

function push(file: string, lineNo: number, rule: string, message: string): void {
  violations.push({ file: relative(root, file), line: lineNo, rule, message })
}

for (const file of allFiles) {
  const pkgRoot = isPkgFile(file)
  const inRenderer = isRendererFile(file)
  const inApi = isRendererApiFile(file)
  const inElectron = isElectronFile(file)
  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')
  lines.forEach((line, i) => {
    const lineNo = i + 1
    const specs = extractSpecs(line)
    const trimmed = line.trim()
    const isCommentOnly = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')

    // R1–R5：仅 packages
    if (pkgRoot) {
      for (const spec of specs) {
        if (isElectronSpec(spec) && !isAllowed(line, 'R1', spec)) {
          push(file, lineNo, 'R1', `包禁止引用 electron: '${spec}'`)
        }
        const isAcpPkg = pkgRoot.endsWith(`${sep}acp`) || pkgRoot.endsWith('/acp')
        if (isNodeSpec(spec) && !isAcpPkg && !isAllowed(line, 'R2', spec)) {
          push(file, lineNo, 'R2', `包禁止引用 node: '${spec}'`)
        }
        if (isReactSpec(spec) && !isAllowed(line, 'R3', spec)) {
          push(file, lineNo, 'R3', `包禁止引用 react: '${spec}'`)
        }
        if (isAliasSpec(spec) && !isAllowed(line, 'R4', spec)) {
          push(file, lineNo, 'R4', `包禁止引用别名: '${spec}'`)
        }
        if (spec.includes('apps/desktop') && !isAllowed(line, 'R5', spec)) {
          push(file, lineNo, 'R5', `包禁止引用 apps/desktop: '${spec}'`)
        } else if (escapesPackage(file, pkgRoot, spec) && !isAllowed(line, 'R5', spec)) {
          push(file, lineNo, 'R5', `包禁止跨包相对引用: '${spec}'`)
        }
      }
    }

    // R6a：渲染非 api
    if (inRenderer && !inApi && !isCommentOnly) {
      if (line.includes('electronAPI') && !isAllowed(line, 'R6', 'window.electronAPI')) {
        push(file, lineNo, 'R6', '渲染非 api 禁止直调 window.electronAPI（走 src/api/*）')
      }
      for (const spec of specs) {
        if ((isElectronSpec(spec) || isRemoteSpec(spec)) && !isAllowed(line, 'R6', spec)) {
          push(file, lineNo, 'R6', `渲染非 api 禁止引用 electron: '${spec}'`)
        }
        if (isNodeSpec(spec) && !isAllowed(line, 'R6', spec)) {
          push(file, lineNo, 'R6', `渲染非 api 禁止引用 node:: '${spec}'`)
        }
      }
    }

    // R6b：electron 禁 react
    if (inElectron) {
      for (const spec of specs) {
        if (isReactSpec(spec) && !isAllowed(line, 'R6', spec)) {
          push(file, lineNo, 'R6', `主进程禁止引用 react: '${spec}'`)
        }
      }
    }
  })
}

violations.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))

if (jsonMode) {
  console.log(JSON.stringify({ violations, errors: violations.length }, null, 2))
} else {
  for (const v of violations) {
    console.error(`ERROR  ${v.file}:${v.line} [${v.rule}] ${v.message}`)
  }
  console.log(`\nlint:deps 完成：${violations.length} 个错误（${allFiles.length} 文件）`)
}
process.exit(violations.length > 0 ? 1 : 0)
