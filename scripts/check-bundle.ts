/**
 * 打包回归门禁（6.2 体积 + 6.3 主进程依赖白名单）。
 * Run: bun run build && bun run check:bundle（CI 在构建后执行）
 *
 * 6.2 体积：首屏 index chunk 与 out/ 总量设上限，阅读器懒 chunk 必须独立存在
 *     （防止某次改动把 PdfViewer/EpubViewer 打回主包而无人察觉）。
 * 6.3 白名单：apps/desktop/electron/（不含单测与构建期 vite-plugins）引用的裸包，必须出现在
 *     apps/desktop/electron-builder.yml 的 files node_modules 白名单里——主进程构建默认
 *     externalize，漏配的包在打包版运行时 require 即崩溃。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out')
const assetsDir = join(outDir, 'renderer', 'assets')

const INDEX_BUDGET_BYTES = Math.floor(1.8 * 1024 * 1024)
// 25MB → 30MB：PDF 结构化解析 WASM（pdf_inspector_wasm_bg*.wasm 约 5MB，
// 懒加载、仅 Agent 正文/导出使用）是有意引入的体积，需同步放宽总量门禁
const OUT_TOTAL_BUDGET_BYTES = 30 * 1024 * 1024
const REQUIRED_LAZY_CHUNKS = ['PdfViewer-', 'WebDocViewer-', 'FoliateReaderViewer-', 'pdf-structure.worker-']

let failures = 0

function fail(message: string): void {
  failures++
  console.error(`FAIL  ${message}`)
}

function pass(message: string): void {
  console.log(`PASS  ${message}`)
}

function dirSizeBytes(dir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      const sub = dirSizeBytes(full)
      bytes += sub.bytes
      files += sub.files
    } else {
      bytes += stat.size
      files += 1
    }
  }
  return { bytes, files }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

// ---- 6.2 体积门禁 ----
const indexChunks = readdirSync(assetsDir).filter(
  (name) => /^index-.*\.js$/.test(name) && statSync(join(assetsDir, name)).isFile(),
)
if (indexChunks.length === 0) {
  fail('未找到首屏 index-*.js chunk')
} else {
  for (const name of indexChunks) {
    const size = statSync(join(assetsDir, name)).size
    if (size > INDEX_BUDGET_BYTES) {
      fail(`首屏 ${name} ${mb(size)} 超过预算 ${mb(INDEX_BUDGET_BYTES)}`)
    } else {
      pass(`首屏 ${name} ${mb(size)}（预算 ${mb(INDEX_BUDGET_BYTES)}）`)
    }
  }
}

for (const prefix of REQUIRED_LAZY_CHUNKS) {
  const found = readdirSync(assetsDir).some((name) => name.startsWith(prefix) && name.endsWith('.js'))
  if (!found) fail(`缺失懒加载 chunk: ${prefix}*.js（可能被打回主包）`)
  else pass(`懒加载 chunk 存在: ${prefix}*.js`)
}

const total = dirSizeBytes(outDir)
if (total.bytes > OUT_TOTAL_BUDGET_BYTES) {
  fail(`out/ 总量 ${mb(total.bytes)} 超过预算 ${mb(OUT_TOTAL_BUDGET_BYTES)}`)
} else {
  pass(`out/ 总量 ${mb(total.bytes)} / ${total.files} 文件（预算 ${mb(OUT_TOTAL_BUDGET_BYTES)}）`)
}

// ---- 6.3 主进程依赖白名单 ----
const SCAN_ROOT = join(root, 'apps/desktop', 'electron')
const SKIP_DIRS = new Set(['vite-plugins'])
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collectTsFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

function toPackageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('~/')) return null
  // 路径别名（electron.vite.config.ts / vitest.config.ts）与 Electron 运行时内置模块
  // Monorepo workspace 包经 electron.vite.config.ts workspaceAlias 直接打进 bundle，
  // 主进程产物无运行时 require（已验 out/main 无 @montree 引用），不进 files 白名单
  if (specifier === '@montree/contracts' || specifier.startsWith('@montree/')) return null
  if (specifier === 'electron') return null
  if (specifier.startsWith('node:') || BUILTINS.has(specifier)) return null
  if (specifier.includes('://') || specifier.startsWith('/') || specifier.endsWith('.css')) return null
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) {
    if (parts.length < 2) return null
    return `${parts[0]}/${parts[1]}`
  }
  return parts[0] ?? null
}

const mainDeps = new Set<string>()
for (const file of collectTsFiles(SCAN_ROOT)) {
  const lines = readFileSync(file, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    if (/^\s*import\s+type\b/.test(line)) continue
    for (const match of line.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const pkg = toPackageName(match[1] ?? '')
      if (pkg) mainDeps.add(pkg)
    }
    // CJS 运行时依赖经 createRequire 加载（静态 import 写法会被 externalize 误伤，故显式绕过）
    for (const match of line.matchAll(/cjsRequire\s*\(\s*['"]([^'"]+)['"]/g)) {
      const pkg = toPackageName(match[1] ?? '')
      if (pkg) mainDeps.add(pkg)
    }
  }
}

const yml = readFileSync(join(root, 'apps/desktop', 'electron-builder.yml'), 'utf-8')
const whitelisted = new Set<string>()
for (const match of yml.matchAll(/node_modules\/(@[^/\s*]+\/[^/\s*]+|[^/\s*]+)/g)) {
  whitelisted.add(match[1] ?? '')
}

for (const dep of [...mainDeps].sort()) {
  if (!whitelisted.has(dep)) {
    fail(`主进程依赖未进打包白名单: ${dep}（electron-builder.yml files 缺 node_modules/${dep}）`)
  }
}
if (failures === 0) {
  pass(`主进程 ${mainDeps.size} 个裸包依赖均在打包白名单内`)
}

console.log(failures > 0 ? `\ncheck:bundle 未通过：${failures} 项` : '\ncheck:bundle 全部通过')
process.exit(failures > 0 ? 1 : 0)
