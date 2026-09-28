import { describe, expect, it } from 'vitest'
import { DEEPSEEK_DSH_NPM_PACKAGE } from '@inkdown/contracts'
import {
  buildDeepseekMissingKeyMessage,
  deepseekAdapter,
  probeDeepseekAuth,
  resolveDeepseekSpawnBlocker,
  resolveDeepseekSpawnCommand,
} from './index'

describe('deepseek 缺 key 预检判停', () => {
  it('缺 key 判停文案含安装动作', () => {
    const message = buildDeepseekMissingKeyMessage()
    expect(message).toContain('DEEPSEEK_API_KEY')
    expect(message).toContain('终端')
    const blocked = resolveDeepseekSpawnBlocker({})
    expect(blocked).toBe(message)
  })

  it('空白 key 视同缺失', () => {
    expect(resolveDeepseekSpawnBlocker({ DEEPSEEK_API_KEY: '   ' })).toContain(
      'DEEPSEEK_API_KEY',
    )
  })

  it('有 key 放行（null）', () => {
    expect(resolveDeepseekSpawnBlocker({ DEEPSEEK_API_KEY: 'sk-x' })).toBeNull()
  })

  it('adapter 经 resolveSpawnBlocker 接线（可选 + 缺省兼容）', () => {
    expect(deepseekAdapter.resolveSpawnBlocker).toBeTypeOf('function')
  })

  it('probeAuth 与阻断一致：无 key 不谎报已登录', () => {
    const saved = process.env.DEEPSEEK_API_KEY
    try {
      delete process.env.DEEPSEEK_API_KEY
      expect(probeDeepseekAuth().looksLoggedIn).toBe(false)
      expect(resolveDeepseekSpawnBlocker()).toContain('DEEPSEEK_API_KEY')
    } finally {
      if (saved === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = saved
    }
  })
})

describe('deepseek DSH_PACKAGE 包定位符覆盖', () => {
  it('缺省走 contracts 常量并带 @latest（每次冷启动直取最新）', () => {
    expect(DEEPSEEK_DSH_NPM_PACKAGE).toBe('@deepseek-ai/dsh')
    expect(resolveDeepseekSpawnCommand({})).toEqual({
      command: 'bunx',
      args: ['-y', `${DEEPSEEK_DSH_NPM_PACKAGE}@latest`, '--profile', 'acp'],
    })
  })

  it('合法覆盖透传（如 pin 旧版绕上游坏依赖）', () => {
    expect(
      resolveDeepseekSpawnCommand({ DSH_PACKAGE: '@deepseek-ai/dsh@0.1.4' }),
    ).toEqual({
      command: 'bunx',
      args: ['-y', '@deepseek-ai/dsh@0.1.4', '--profile', 'acp'],
    })
  })

  it('非法值回落缺省（空格/shell 元字符，回落同样带 @latest）', () => {
    for (const bad of ['', '   ', 'pkg with-space', 'pkg;rm -rf', 'pkg$(id)', 'pkg|tee', 'pkg`id`']) {
      expect(resolveDeepseekSpawnCommand({ DSH_PACKAGE: bad })).toEqual({
        command: 'bunx',
        args: ['-y', `${DEEPSEEK_DSH_NPM_PACKAGE}@latest`, '--profile', 'acp'],
      })
    }
  })

  it('adapter 经 resolveSpawnCommand 接线（spawn 目标覆盖 precedent 照抄 cursor）', () => {
    expect(deepseekAdapter.resolveSpawnCommand).toBeTypeOf('function')
  })
})
