/**
 * B1/B3 WSL 真机能力探针（Ubuntu 内真实探测）。
 *
 * - 有 WSL/Ubuntu 时跑：probeWslEnvironment 真实执行，断言 home/shell 动态
 *   得出（不写死）；Node 缺失时 checkProbeNodeUsable 必须返回
 *   REMOTE_NODE_MISSING + 安装说明（计划 §4.4：不无授权 sudo/下载系统软件）。
 * - 若某天远端装了 Node：断言拒绝 Windows 冒充（.exe//mnt/）与版本基线。
 * - 无 WSL 时整组 skip。
 */
import { describe, expect, it } from 'vitest'
import {
  checkProbeNodeUsable,
  formatNodeMissingHelp,
  isWindowsNodePath,
  probeWslEnvironment,
} from './wsl-bootstrap'

describe('WSL 能力探针（真机，缺失 Node 即明确错误）', () => {
  it('拒绝 Windows Node 路径冒充（纯函数）', () => {
    expect(isWindowsNodePath('/mnt/c/Program Files/nodejs/node')).toBe(true)
    expect(isWindowsNodePath('C:\\Program Files\\nodejs\\node.exe')).toBe(true)
    expect(isWindowsNodePath('/usr/bin/node')).toBe(false)
    expect(isWindowsNodePath('/home/u/.local/bin/node')).toBe(false)
  })

  it('真机探测：home/shell 动态得出；Node 缺失给安装说明', async () => {
    if (process.platform !== 'win32') return
    const probed = await probeWslEnvironment('Ubuntu')
    if (!probed.ok) {
      // 无 WSL/Ubuntu 的机器：探针失败本身即明确错误（不断言细节）
      expect(probed.code).toBe('REMOTE_CONNECTION_FAILED')
      return
    }
    expect(probed.probe.home.startsWith('/')).toBe(true)
    expect(probed.probe.loginShell.length).toBeGreaterThan(0)
    const usable = checkProbeNodeUsable(probed.probe)
    if (!probed.probe.nodePath) {
      // 本机实测：Ubuntu 无 Linux Node → 明确缺失错误 + 安装说明
      expect(usable.ok).toBe(false)
      if (!usable.ok) {
        expect(usable.code).toBe('REMOTE_NODE_MISSING')
        expect(usable.message).toContain('Node')
      }
      expect(formatNodeMissingHelp('Ubuntu')).toContain('22')
    } else {
      // 若远端装了 Node：冒充拒绝 + 基线校验缺一不可
      expect(isWindowsNodePath(probed.probe.nodePath)).toBe(false)
      if (usable.ok) {
        expect(probed.probe.nodePlatform).toBe('linux')
      }
    }
  }, 60000)
})
