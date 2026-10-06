import { describe, expect, it } from 'vitest'
import {
  agyAdapter,
  buildAgyMissingCliMessage,
  probeAgyAuth,
  probeAgyCli,
  resolveAgyCliBin,
  resolveAgyRuntimeEnv,
  resolveAgySpawnCommand,
} from './index'

describe('agyAdapter & Antigravity CLI 路径探测自愈', () => {
  it('probe 中性空结果（authMethods 为 []，直连即可）', () => {
    const probed = probeAgyAuth()
    expect(probed.looksLoggedIn).toBe(false)
    expect(probed.hasAuthFile).toBe(false)
    expect(probed.hasApiKeyEnv).toBe(false)
    expect(agyAdapter.probeAuth()).toEqual(probed)
  })

  it('tryDirectSessionFirst=true（authMethods 为空时直建会话）', () => {
    expect(agyAdapter.tryDirectSessionFirst).toBe(true)
    expect(agyAdapter.id).toBe('agy')
  })

  it('优先命中 AGY_BIN 环境变量', () => {
    const mockBin = 'D:\\custom\\bin\\agy.exe'
    const found = resolveAgyCliBin({
      env: { AGY_BIN: mockBin },
      existsSync: (p) => p === mockBin,
    })
    expect(found).toBe(mockBin)
  })

  it('命中系统 PATH 中的 agy 命令', () => {
    const found = resolveAgyCliBin({
      platform: 'win32',
      env: { PATH: 'C:\\Windows;C:\\bin' },
      existsSync: (p) => p === 'C:\\bin\\agy.exe',
    })
    expect(found).toBe('agy.exe')
  })

  it('自愈探测 Windows %LOCALAPPDATA%\\agy\\bin\\agy.exe 默认安装路径', () => {
    const expected = 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe'
    const found = resolveAgyCliBin({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PATH: 'C:\\Windows' },
      existsSync: (p) => p === expected,
    })
    expect(found).toBe(expected)
  })

  it('自愈探测 posix ~/.local/bin/agy 默认安装路径', () => {
    const expected = '/home/test/.local/bin/agy'
    const found = resolveAgyCliBin({
      platform: 'linux',
      home: '/home/test',
      env: { HOME: '/home/test', PATH: '/usr/bin' },
      existsSync: (p) => p === expected,
    })
    expect(found).toBe(expected)
  })

  it('所有路径均不存在时返回 null', () => {
    const found = resolveAgyCliBin({
      platform: 'win32',
      env: { PATH: '' },
      existsSync: () => false,
    })
    expect(found).toBeNull()
  })

  it('resolveAgyRuntimeEnv 命中完整路径时自动补充 AGY_BIN 与 PATH', () => {
    const expected = 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe'
    const env = resolveAgyRuntimeEnv({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', PATH: 'C:\\Windows' },
      existsSync: (p) => p === expected,
    })
    expect(env.AGY_BIN).toBe(expected)
    expect(env.PATH).toContain('C:\\Users\\test\\AppData\\Local\\agy\\bin')
  })

  it('未安装时 resolveAgySpawnCommand 返回 null 触发未安装拦截', () => {
    const res = resolveAgySpawnCommand({
      platform: 'win32',
      env: { PATH: '' },
      existsSync: () => false,
    })
    expect(res).toBeNull()
  })

  it('已安装时 resolveAgySpawnCommand 返回 bunx 桥接调用模板', () => {
    const res = resolveAgySpawnCommand({
      platform: 'win32',
      env: { PATH: 'C:\\bin' },
      existsSync: (p) => p === 'C:\\bin\\agy.exe',
    })
    expect(res?.command).toBe('bunx')
    expect(res?.args[1]).toContain('@yitom/agy-acp-map')
  })

  it('buildAgyMissingCliMessage 生成平台专用的清晰中文安装指引', () => {
    const winMsg = buildAgyMissingCliMessage({ platform: 'win32' })
    expect(winMsg).toContain('install.ps1')
    expect(winMsg).toContain('一键安装')

    const posixMsg = buildAgyMissingCliMessage({ platform: 'linux' })
    expect(posixMsg).toContain('install.sh')
    expect(posixMsg).toContain('一键安装')
  })

  it('probeAgyCli 未安装时返回 installed: false', async () => {
    const status = await probeAgyCli({
      env: { PATH: '' },
      existsSync: () => false,
    })
    expect(status.installed).toBe(false)
  })
})
