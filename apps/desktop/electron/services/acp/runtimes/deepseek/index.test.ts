import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEEPSEEK_DSH_NPM_PACKAGE } from '@yitom/contracts'
import {
  buildDeepseekMissingKeyMessage,
  deepseekAdapter,
  probeDeepseekAuth,
  resolveDeepseekSpawnBlocker,
  resolveDeepseekSpawnCommand,
} from './index'

const homes: string[] = []

function emptyHarnessHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'montree-dsh-home-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('deepseek 缺 key 预检判停', () => {
  it('既无 env key 也无本地登录时判停，文案含两条动作', () => {
    const message = buildDeepseekMissingKeyMessage()
    expect(message).toContain('DEEPSEEK_API_KEY')
    expect(message).toContain('credentials.yaml')
    const blocked = resolveDeepseekSpawnBlocker({ DSH_HOME: emptyHarnessHome() })
    expect(blocked).toBe(message)
  })

  it('空白 key 视同缺失', () => {
    expect(
      resolveDeepseekSpawnBlocker({ DEEPSEEK_API_KEY: '   ', DSH_HOME: emptyHarnessHome() }),
    ).toContain('DEEPSEEK_API_KEY')
  })

  it('有 key 放行（null）', () => {
    expect(resolveDeepseekSpawnBlocker({ DEEPSEEK_API_KEY: 'sk-x' })).toBeNull()
  })

  it('复用 DSH 自身登录：~/.dsh/.credentials.yaml 非空即放行', () => {
    const home = emptyHarnessHome()
    const blocked = resolveDeepseekSpawnBlocker({ DSH_HOME: home })
    expect(blocked).not.toBeNull()
    writeFileSync(join(home, '.credentials.yaml'), 'token: fixture\n')
    expect(resolveDeepseekSpawnBlocker({ DSH_HOME: home })).toBeNull()
  })

  it('空 credentials 文件不算已登录', () => {
    const home = emptyHarnessHome()
    writeFileSync(join(home, '.credentials.yaml'), '')
    expect(resolveDeepseekSpawnBlocker({ DSH_HOME: home })).toContain('DEEPSEEK_API_KEY')
  })

  it('adapter 经 resolveSpawnBlocker 接线（可选 + 缺省兼容）', () => {
    expect(deepseekAdapter.resolveSpawnBlocker).toBeTypeOf('function')
  })

  it('probeAuth 与阻断一致：无 key 且无本地登录时不谎报已登录', () => {
    const savedKey = process.env.DEEPSEEK_API_KEY
    const savedHome = process.env.DSH_HOME
    try {
      delete process.env.DEEPSEEK_API_KEY
      process.env.DSH_HOME = emptyHarnessHome()
      const probe = probeDeepseekAuth()
      expect(probe.hasAuthFile).toBe(false)
      expect(probe.looksLoggedIn).toBe(false)
      expect(resolveDeepseekSpawnBlocker()).toContain('DEEPSEEK_API_KEY')
    } finally {
      if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = savedKey
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
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
