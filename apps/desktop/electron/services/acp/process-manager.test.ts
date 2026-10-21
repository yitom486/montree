import { describe, expect, it, vi } from 'vitest'
import {
  ACP_EARLY_EXIT_STDERR_TAIL_LINES,
  getAcpEarlyExitStderrDetail,
  getLiveAcpProcess,
  isSpawnedAcpProcessAlive,
  spawnAcpProcess,
  withAcpEarlyExitDetail,
} from './process-manager'

describe('连接失败自诊断（stderr 尾部拼进连接失败错误，去窗口化）', () => {
  it('早退带 stderr 尾', () => {
    const now = Date.now()
    const detail = getAcpEarlyExitStderrDetail(
      { spawnedAt: now - 500, stderrTail: ['harness: missing key', 'second line'] },
      now,
    )
    expect(detail).toContain('harness: missing key')
    expect(detail).toContain('second line')
    const message = withAcpEarlyExitDetail('ACP connection closed', detail)
    expect(message).toContain('ACP connection closed')
    expect(message).toContain('stderr 尾部')
    expect(message).toContain('harness: missing key')
  })

  it('无 stderr 不崩（null/空尾返回原文）', () => {
    const now = Date.now()
    expect(getAcpEarlyExitStderrDetail(null, now)).toBeNull()
    expect(getAcpEarlyExitStderrDetail(undefined, now)).toBeNull()
    expect(
      getAcpEarlyExitStderrDetail({ spawnedAt: now, stderrTail: [] }, now),
    ).toBeNull()
    expect(
      getAcpEarlyExitStderrDetail({ spawnedAt: now, stderrTail: ['   ', ''] }, now),
    ).toBeNull()
    expect(withAcpEarlyExitDetail('ACP connection closed', null)).toBe(
      'ACP connection closed',
    )
  })

  it('慢退同样带尾（去窗口化：窗口外不再返回 null）', () => {
    const now = Date.now()
    const detail = getAcpEarlyExitStderrDetail(
      {
        spawnedAt: now - 60_000,
        stderrTail: ['harness: missing key'],
      },
      now,
    )
    expect(detail).toContain('harness: missing key')
    expect(withAcpEarlyExitDetail('ACP connection closed', detail)).toContain(
      'stderr 尾部',
    )
  })

  it('尾部截断到单处常量行数', () => {
    const now = Date.now()
    const tail = Array.from(
      { length: ACP_EARLY_EXIT_STDERR_TAIL_LINES + 5 },
      (_, i) => `line-${i}`,
    )
    const detail = getAcpEarlyExitStderrDetail({ spawnedAt: now, stderrTail: tail }, now)
    expect(detail).not.toBeNull()
    expect(detail!.split('\n')).toHaveLength(ACP_EARLY_EXIT_STDERR_TAIL_LINES)
    expect(detail).not.toContain('line-0')
  })
})

describe('resolveAcpExecution', () => {
  it('WSL 中使用 Linux opencode，不能沿用 Windows opencode.exe 模板', async () => {
    const { resolveAcpExecution } = await import('./process-manager')
    const runtime = { id: 'opencode', name: 'OpenCode', description: '', command: 'opencode.exe', args: ['acp'], requiredEnvKeys: [] }
    if (process.platform === 'win32') {
      const execution = resolveAcpExecution(runtime, '\\\\wsl.localhost\\Ubuntu\\home\\tomy')
      expect(execution.args.at(-1)).toContain('opencode')
      expect(execution.args.at(-1)).not.toContain('opencode.exe')
    }
  })
  it('不同 WSL 发行版与原生环境不能复用同一进程', async () => {
    const { acpExecutionContext } = await import('./process-manager')
    if (process.platform === 'win32') {
      expect(acpExecutionContext('D:\\notes')).toBe('native')
      expect(acpExecutionContext('\\\\wsl.localhost\\Ubuntu\\home\\tomy')).toBe('wsl:Ubuntu')
      expect(acpExecutionContext('\\\\wsl.localhost\\Debian\\home\\tomy')).not.toBe(acpExecutionContext('\\\\wsl.localhost\\Ubuntu\\home\\tomy'))
    }
  })
  it('WSL 路径自动切换为 wsl.exe 并穿透进入 Linux 命名空间', async () => {
    const { resolveAcpExecution } = await import('./process-manager')
    const runtime = {
      id: 'codex-acp',
      name: 'Codex ACP',
      description: 'Codex ACP Runtime',
      command: 'bunx',
      args: ['@yitom/codex-acp@latest'],
      requiredEnvKeys: [],
    }

    const execution = resolveAcpExecution(runtime, '\\\\wsl.localhost\\Ubuntu\\home\\tomy\\blog')
    if (process.platform === 'win32') {
      expect(execution.file).toBe('wsl.exe')
      expect(execution.shell).toBe(false)
      expect(execution.args).toContain('-d')
      expect(execution.args).toContain('Ubuntu')
      expect(execution.args).toContain('--cd')
      expect(execution.args).toContain('/home/tomy/blog')
      expect(execution.args[execution.args.length - 1]).toContain('bunx')
      expect(execution.args[execution.args.length - 1]).toContain('${SHELL:-/bin/sh}')
    }
  })

  it('普通路径保持原生命令', async () => {
    const { resolveAcpExecution } = await import('./process-manager')
    const runtime = {
      id: 'codex-acp',
      name: 'Codex ACP',
      description: 'Codex ACP Runtime',
      command: 'bunx',
      args: ['@yitom/codex-acp@latest'],
      requiredEnvKeys: [],
    }

    const execution = resolveAcpExecution(runtime, 'D:\\notes')
    expect(execution.file).toBe('bunx')
    expect(execution.args).toEqual(['@yitom/codex-acp@latest'])
    expect(execution.cwd).toBe('D:\\notes')
  })

  it('温复用认规则标签：一致命中、不一致拒绝、无要求沿旧语义', async () => {
    const tagA = 'codex-acp:rules@aaa'
    const tagB = 'codex-acp:rules@bbb'
    const runtime = {
      id: `tag-probe-${Date.now()}`,
      name: 'Tag Test Runtime',
      description: 'tag match probe',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 60000)'],
      requiredEnvKeys: [],
    }
    const handle = spawnAcpProcess({ runtime, cwd: process.cwd(), profileTag: tagA })
    try {
      expect(isSpawnedAcpProcessAlive(handle)).toBe(true)
      expect(handle.profileTag).toBe(tagA)
      // 标签一致命中；不一致拒绝；不要求标签时沿旧语义命中
      expect(getLiveAcpProcess(runtime.id, undefined, tagA)).toBe(handle)
      expect(getLiveAcpProcess(runtime.id, undefined, tagB)).toBeUndefined()
      expect(getLiveAcpProcess(runtime.id)).toBe(handle)
      expect(getLiveAcpProcess(runtime.id, undefined, null)).toBeUndefined()
    } finally {
      handle.kill()
      // kill 经 taskkill/信号异步落定：同步断言会撞中间态，等 exit 回填
      await vi.waitFor(() => expect(isSpawnedAcpProcessAlive(handle)).toBe(false), {
        timeout: 8000,
      })
    }
  })

  it('Agent 退出后继续写 stdin 不产生未捕获 EPIPE，并把断开原因写进 stderr 尾部', async () => {
    const runtime = {
      id: `epipe-probe-${Date.now()}`,
      name: 'EPIPE Probe',
      description: 'closes stdin then exits',
      command: process.execPath,
      // 先关掉读端再拖一会儿退出：复现「进程正在退出、管道读端已关」时写入触发 EPIPE 的竞态
      args: ['-e', "require('fs').closeSync(0); setTimeout(() => process.exit(0), 800)"],
      requiredEnvKeys: [],
    }
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => { uncaught.push(error) }
    process.on('uncaughtException', onUncaught)
    let exited = false
    const handle = spawnAcpProcess({ runtime, cwd: process.cwd(), onExit: () => { exited = true } })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      // 模拟 SDK 桥接在 Agent 退出途中的迟到写入
      for (let i = 0; i < 20; i += 1) handle.child.stdin.write('{"jsonrpc":"2.0","method":"late"}\n')
      await vi.waitFor(() => expect(handle.stderrTail.join('\n')).toMatch(/stdin 已断开/), { timeout: 5_000 })
      await vi.waitFor(() => expect(exited).toBe(true), { timeout: 10_000 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(uncaught).toEqual([])
      expect(getAcpEarlyExitStderrDetail(handle, Date.now())).toContain('stdin 已断开')
    } finally {
      process.off('uncaughtException', onUncaught)
      handle.kill()
    }
  })
})
