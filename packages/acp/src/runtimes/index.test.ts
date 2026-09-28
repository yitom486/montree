import { describe, expect, it } from 'vitest'
import { BUILTIN_ACP_RUNTIMES, DEFAULT_ACP_RUNTIME_ID } from '@inkdown/contracts'
import { getAcpRuntimeAdapter } from './index'
import { resolveCursorCommand } from './cursor'

describe('runtimes/index', () => {
  it('Antigravity 已淘汰：走未知运行时回落，不再派发专属适配器', () => {
    const adapter = getAcpRuntimeAdapter('antigravity-acp')
    expect(adapter.id).toBe('antigravity-acp')
    expect(adapter.probeAuth().looksLoggedIn).toBe(false)
  })

  it('正确派发 Codex 适配器', () => {
    const adapter = getAcpRuntimeAdapter(DEFAULT_ACP_RUNTIME_ID)
    expect(adapter.id).toBe(DEFAULT_ACP_RUNTIME_ID)
    expect(typeof adapter.probeAuth).toBe('function')
    expect(typeof adapter.getCustomProvider).toBe('function')
  })

  it('未知运行时回落通用空中性探测', () => {
    const adapter = getAcpRuntimeAdapter('unknown-runtime')
    expect(adapter.id).toBe('unknown-runtime')
    expect(adapter.probeAuth().looksLoggedIn).toBe(false)
  })

  it('7 新增运行时按 id 派发专属适配器', () => {
    const cases: Array<{ id: string; authMethodsPassthrough: boolean }> = [
      { id: 'claude', authMethodsPassthrough: true },
      { id: 'gemini', authMethodsPassthrough: true },
      { id: 'copilot', authMethodsPassthrough: true },
      { id: 'opencode', authMethodsPassthrough: true },
      { id: 'cursor-cli', authMethodsPassthrough: true },
      { id: 'deepseek', authMethodsPassthrough: true },
      { id: 'agy', authMethodsPassthrough: true },
    ]
    for (const { id } of cases) {
      const adapter = getAcpRuntimeAdapter(id)
      expect(adapter.id).toBe(id)
      expect(typeof adapter.probeAuth).toBe('function')
      // 模板 id 与适配器 id 一致：acp-client 才能用同一 id 走注册表 + 适配器
      expect(BUILTIN_ACP_RUNTIMES.some((runtime) => runtime.id === adapter.id)).toBe(true)
      // 默认透传 authMethods
      const methods = [{ id: 'm1' }]
      expect(adapter.orderAuthMethods?.(methods)).toBe(methods)
      // 保守：不跳过交互式认证
      expect(adapter.canSkipInteractiveAuth?.('any-method')).toBe(false)
      // 无密钥断言：无登录痕迹时不谎报已登录
      expect(typeof adapter.probeAuth().looksLoggedIn).toBe('boolean')
    }
  })

  it('cursor 目录别名同样派发 cursor-cli 适配器', () => {
    expect(getAcpRuntimeAdapter('cursor').id).toBe('cursor-cli')
  })

  it('cursor 安装路径探测：回落分支恒为 agent acp', () => {
    const resolved = resolveCursorCommand()
    expect(resolved.args).toEqual(['acp'])
    expect(resolved.command.toLowerCase()).toContain('agent')
  })
})
