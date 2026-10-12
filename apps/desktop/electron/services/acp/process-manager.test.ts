import { describe, expect, it } from 'vitest'
import {
  ACP_EARLY_EXIT_STDERR_TAIL_LINES,
  getAcpEarlyExitStderrDetail,
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
})

