import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCursorMissingCliMessage,
  clearCursorCatalogCache,
  cursorAdapter,
  getCursorCatalogIds,
  isHintCursorStorageFile,
  isValidCursorAuthFile,
  parseCursorCatalogOutput,
  probeCursorAuth,
  resolveCursorAuthCandidates,
  resolveCursorSpawnCommand,
} from './index'

describe('cursor resolveSpawnCommand（未安装预检）', () => {
  it('未安装返回 null：直接路径与 PATH 皆无', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'inkdown-cursor-empty-'))
    try {
      const resolved = resolveCursorSpawnCommand({
        platform: 'win32',
        env: { LOCALAPPDATA: emptyDir, USERPROFILE: emptyDir, PATH: emptyDir },
      })
      expect(resolved).toBeNull()
      expect(cursorAdapter.resolveSpawnCommand).toBeTypeOf('function')
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('未安装错文案含安装指引（win）', () => {
    const message = buildCursorMissingCliMessage({ platform: 'win32' })
    expect(message).toContain('Cursor CLI 未安装')
    expect(message).toContain('irm https://cursor.com/install?win32=true | iex')
  })

  it('未安装错文案含安装指引（posix）', () => {
    const message = buildCursorMissingCliMessage({ platform: 'linux' })
    expect(message).toContain('Cursor CLI 未安装')
    expect(message).toContain('cursor.com/install')
  })

  it('已安装透传直接路径（win %LOCALAPPDATA%\\cursor-agent\\agent.cmd）', () => {
    const local = mkdtempSync(join(tmpdir(), 'inkdown-cursor-direct-'))
    try {
      mkdirSync(join(local, 'cursor-agent'), { recursive: true })
      const cmd = join(local, 'cursor-agent', 'agent.cmd')
      writeFileSync(cmd, '@echo off', 'utf8')
      const resolved = resolveCursorSpawnCommand({
        platform: 'win32',
        env: { LOCALAPPDATA: local, USERPROFILE: local, PATH: '' },
      })
      expect(resolved).toEqual({ command: cmd, args: ['acp'] })
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })

  it('已安装透传 PATH 回落（posix agent）', () => {
    const bin = mkdtempSync(join(tmpdir(), 'inkdown-cursor-path-'))
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-home-'))
    try {
      writeFileSync(join(bin, 'agent'), '#!/bin/sh', 'utf8')
      const resolved = resolveCursorSpawnCommand({
        platform: 'linux',
        env: { PATH: bin },
        home,
      })
      expect(resolved).toEqual({ command: 'agent', args: ['acp'] })
    } finally {
      rmSync(bin, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('已安装透传直接路径（posix ~/.local/bin/agent）', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-home2-'))
    try {
      mkdirSync(join(home, '.local', 'bin'), { recursive: true })
      const agent = join(home, '.local', 'bin', 'agent')
      writeFileSync(agent, '#!/bin/sh', 'utf8')
      const resolved = resolveCursorSpawnCommand({
        platform: 'linux',
        env: { PATH: '' },
        home,
      })
      expect(resolved).toEqual({ command: agent, args: ['acp'] })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('probeCursorAuth（文件+环境双查）', () => {
  function writePosixAuth(home: string, content: string): string {
    const dir = join(home, '.config', 'cursor')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'auth.json')
    writeFileSync(target, content, 'utf8')
    return target
  }

  it('posix auth.json 含 accessToken 判已登录', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-auth-'))
    try {
      writePosixAuth(home, JSON.stringify({ accessToken: 'tok-123', refreshToken: '' }))
      const result = probeCursorAuth({ platform: 'linux', env: {}, home })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(true)
      expect(result.hasApiKeyEnv).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('posix auth.json 仅 refreshToken 也判已登录', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-auth-r-'))
    try {
      writePosixAuth(home, JSON.stringify({ refreshToken: 'ref-abc' }))
      expect(
        probeCursorAuth({ platform: 'linux', env: {}, home }).looksLoggedIn,
      ).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('posix 缺失判未登录（不下结论，由 gate try-first 兜底）', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-auth-miss-'))
    try {
      const result = probeCursorAuth({ platform: 'linux', env: {}, home })
      expect(result.hasAuthFile).toBe(false)
      expect(result.looksLoggedIn).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('posix 空文件判未登录：存在但去空白后为空', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-auth-empty-'))
    try {
      writePosixAuth(home, '   \n\t  \n')
      const result = probeCursorAuth({ platform: 'linux', env: {}, home })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('posix 坏 JSON / 无 token key 判未登录', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-auth-bad-'))
    try {
      writePosixAuth(home, '{not-json')
      expect(probeCursorAuth({ platform: 'linux', env: {}, home }).looksLoggedIn).toBe(false)
      writePosixAuth(home, JSON.stringify({ foo: 1 }))
      expect(probeCursorAuth({ platform: 'linux', env: {}, home }).looksLoggedIn).toBe(false)
      writePosixAuth(home, JSON.stringify({ accessToken: '   ', refreshToken: '' }))
      expect(probeCursorAuth({ platform: 'linux', env: {}, home }).looksLoggedIn).toBe(false)
      expect(isValidCursorAuthFile(join(home, '.config', 'cursor', 'auth.json'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('环境变量 CURSOR_API_KEY / CURSOR_AUTH_TOKEN 命中判已登录', () => {
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-auth-env-'))
    try {
      expect(
        probeCursorAuth({ platform: 'linux', env: { CURSOR_API_KEY: 'sk-x' }, home })
          .looksLoggedIn,
      ).toBe(true)
      expect(
        probeCursorAuth({ platform: 'linux', env: { CURSOR_AUTH_TOKEN: 'tok-y' }, home })
          .looksLoggedIn,
      ).toBe(true)
      expect(
        probeCursorAuth({ platform: 'linux', env: { CURSOR_API_KEY: '   ' }, home })
          .looksLoggedIn,
      ).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('win XDG 风格优先：%USERPROFILE%\\.config\\cursor\\auth.json 命中', () => {
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-cursor-win-p-'))
    const roaming = mkdtempSync(join(tmpdir(), 'inkdown-cursor-win-r-'))
    try {
      const dir = join(profile, '.config', 'cursor')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'auth.json'), JSON.stringify({ accessToken: 'wintok' }), 'utf8')
      const result = probeCursorAuth({
        platform: 'win32',
        env: { USERPROFILE: profile, APPDATA: roaming },
        home: profile,
      })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(true)
      const candidates = resolveCursorAuthCandidates({
        platform: 'win32',
        env: { USERPROFILE: profile, APPDATA: roaming },
        home: profile,
      })
      expect(candidates[0]).toBe(join(profile, '.config', 'cursor', 'auth.json'))
      expect(candidates[candidates.length - 1]).toBe(
        join(roaming, 'Cursor', 'User', 'globalStorage', 'storage.json'),
      )
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(roaming, { recursive: true, force: true })
    }
  })

  it('win storage.json hint：旧 App 落盘存在即算命中', () => {
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-cursor-win-sp-'))
    const roaming = mkdtempSync(join(tmpdir(), 'inkdown-cursor-win-sr-'))
    try {
      const dir = join(roaming, 'Cursor', 'User', 'globalStorage')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'storage.json'), JSON.stringify({ foo: 'bar' }), 'utf8')
      const result = probeCursorAuth({
        platform: 'win32',
        env: { USERPROFILE: profile, APPDATA: roaming },
        home: profile,
      })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(true)
      expect(isHintCursorStorageFile(join(dir, 'storage.json'))).toBe(true)
    } finally {
      rmSync(profile, { recursive: true, force: true })
      rmSync(roaming, { recursive: true, force: true })
    }
  })

  it('cursorAdapter 置 tryDirectSessionFirst（keychain 兜底）', () => {
    expect(cursorAdapter.tryDirectSessionFirst).toBe(true)
  })
})

describe('parseCursorCatalogOutput（agent models 同源，逐行首 token）', () => {
  it('横杠 id 逐行提取（含描述列只取首 token）', () => {
    const stdout = [
      'grok-4.7-high-fast  Grok 4.7 (High, Fast)',
      'grok-4.7-high  Grok 4.7 (High)',
      '',
      '  claude-sonnet-4-thinking-low   Claude Thinking Low  ',
    ].join('\n')
    expect(parseCursorCatalogOutput(stdout)).toEqual([
      'grok-4.7-high-fast',
      'grok-4.7-high',
      'claude-sonnet-4-thinking-low',
    ])
  })

  it('默认模型行首 `*` 标记剥掉后取 id；auto 保留原样', () => {
    expect(parseCursorCatalogOutput('* composer-2.5-fast Fast Composer\nauto Automatic\n')).toEqual([
      'composer-2.5-fast',
      'auto',
    ])
  })

  it('空输出 / 非字符串一律空数组（调用方判空即 null）', () => {
    expect(parseCursorCatalogOutput('')).toEqual([])
    expect(parseCursorCatalogOutput('   \n\t\n')).toEqual([])
    expect(parseCursorCatalogOutput(undefined)).toEqual([])
    expect(parseCursorCatalogOutput(null)).toEqual([])
  })
})

describe('getCursorCatalogIds（未安装/失败一律 null，不抛）', () => {
  it('无 CLI（resolve null）返回 null', () => {
    clearCursorCatalogCache()
    const emptyDir = mkdtempSync(join(tmpdir(), 'inkdown-cursor-catalog-miss-'))
    try {
      expect(
        getCursorCatalogIds(undefined, {
          platform: 'win32',
          env: { LOCALAPPDATA: emptyDir, USERPROFILE: emptyDir, PATH: emptyDir },
        }),
      ).toBeNull()
    } finally {
      clearCursorCatalogCache()
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('进程级缓存：首次 null 后不再 spawn（换合法 CLI 仍返回 null）', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'inkdown-cursor-catalog-cache-'))
    const bin = mkdtempSync(join(tmpdir(), 'inkdown-cursor-catalog-bin-'))
    const home = mkdtempSync(join(tmpdir(), 'inkdown-cursor-catalog-home-'))
    try {
      clearCursorCatalogCache()
      writeFileSync(join(bin, 'agent'), '#!/bin/sh', 'utf8')
      // 首次：空环境无 CLI → null 并缓存
      expect(
        getCursorCatalogIds(undefined, {
          platform: 'win32',
          env: { LOCALAPPDATA: emptyDir, USERPROFILE: emptyDir, PATH: emptyDir },
        }),
      ).toBeNull()
      // 二次：即使换成合法环境，缓存命中仍 null（不断言跨版本新鲜度）
      expect(
        getCursorCatalogIds(undefined, { platform: 'linux', env: { PATH: bin }, home }),
      ).toBeNull()
    } finally {
      clearCursorCatalogCache()
      rmSync(emptyDir, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
})
