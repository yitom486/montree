/**
 * 本地测试环境体检：`bun run doctor`。
 * 检查单测/E2E 依赖的 Node 版本、原生模块构建工具与已编译产物，给出修复命令。
 */
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

type Check = { name: string; ok: boolean; fix?: string }
const checks: Check[] = []
const has = (bin: string) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true } catch { return false } }
const nodeVersion = (() => { try { return execFileSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8' }).trim() } catch { return '0.0.0' } })()
const [major, minor] = nodeVersion.split('.').map(Number)

checks.push({ name: `Node ${nodeVersion} >= 22.13（单测用到 node:sqlite / Object.groupBy / Iterator / WebSocket / stripTypeScriptTypes）`, ok: major > 22 || (major === 22 && minor >= 13), fix: '安装 .node-version 指定的 Node 24，并确保其位于 PATH 最前' })
if (process.platform !== 'win32') {
  checks.push({ name: 'make / C++ 编译器（node-pty 在 Linux 无预编译包）', ok: has('make') && (has('g++') || has('clang++')), fix: 'Debian/Ubuntu: sudo apt-get install -y build-essential；macOS: xcode-select --install' })
}
const pty = join('node_modules', 'node-pty')
const ptyPrebuilt = existsSync(join(pty, 'prebuilds', `${process.platform}-${process.arch}`))
checks.push({ name: 'node-pty 原生模块（终端 E2E）', ok: ptyPrebuilt || existsSync(join(pty, 'build', 'Release', 'pty.node')), fix: 'bunx electron-rebuild -f -o node-pty' })
checks.push({ name: 'Electron 二进制', ok: existsSync(join('node_modules', 'electron', 'dist')), fix: 'bun node_modules/electron/install.js' })
checks.push({ name: 'Typst 运行时（Typst E2E / typst-live 测试）', ok: existsSync(join('apps', 'desktop', 'resources', 'typst', 'manifest.json')), fix: 'bun run prepare:typst' })
if (process.platform === 'linux') checks.push({ name: 'xvfb-run（Linux 跑 E2E）', ok: has('xvfb-run'), fix: 'sudo apt-get install -y xvfb && bunx playwright install-deps' })

let failed = 0
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.name}`)
  if (!check.ok) { failed++; if (check.fix) console.log(`    修复：${check.fix}`) }
}
if (failed) { console.log(`\n${failed} 项未就绪`); process.exit(1) }
console.log('\n本地测试环境就绪')
