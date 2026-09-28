import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  probeOpencodeAuth,
  resolveOpencodeAuthCandidates,
} from './index'

const saved = {
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  USERPROFILE: process.env.USERPROFILE,
  APPDATA: process.env.APPDATA,
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function winEnv(opts: { xdg?: string; localAppData?: string; userProfile?: string }) {
  return {
    XDG_DATA_HOME: opts.xdg ?? '',
    LOCALAPPDATA: opts.localAppData ?? '',
    USERPROFILE: opts.userProfile ?? '',
    APPDATA: 'C:\\should-not-be-used',
  } satisfies NodeJS.ProcessEnv
}

function writeAuth(dir: string, content: string): string {
  const target = join(dir, 'opencode', 'auth.json')
  mkdirSync(join(dir, 'opencode'), { recursive: true })
  writeFileSync(target, content, 'utf8')
  return target
}

describe('probeOpencodeAuth（Windows 路径修正）', () => {
  it('LOCALAPPDATA 命中判已登录，不再读 %APPDATA%', () => {
    const local = mkdtempSync(join(tmpdir(), 'inkdown-opencode-local-'))
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-opencode-profile-'))
    try {
      writeAuth(local, JSON.stringify({ type: 'api', key: 'sk-test' }))
      const result = probeOpencodeAuth({
        platform: 'win32',
        env: winEnv({ localAppData: local, userProfile: profile }),
      })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(true)
      expect(result.hasApiKeyEnv).toBe(false)
      expect(result.codexHome).toBe(join(local, 'opencode'))
      // 候选顺序：XDG > LOCALAPPDATA > USERPROFILE
      const candidates = resolveOpencodeAuthCandidates({
        platform: 'win32',
        env: winEnv({ localAppData: local, userProfile: profile }),
      })
      expect(candidates[0]).toBe(join(local, 'opencode', 'auth.json'))
    } finally {
      rmSync(local, { recursive: true, force: true })
      rmSync(profile, { recursive: true, force: true })
    }
  })

  it('USERPROFILE 回落：LOCALAPPDATA 无文件时用 %USERPROFILE%\\.local\\share', () => {
    const local = mkdtempSync(join(tmpdir(), 'inkdown-opencode-local-empty-'))
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-opencode-profile-hit-'))
    try {
      mkdirSync(join(profile, '.local', 'share', 'opencode'), { recursive: true })
      writeFileSync(
        join(profile, '.local', 'share', 'opencode', 'auth.json'),
        JSON.stringify({ token: 'abc' }),
        'utf8',
      )
      const result = probeOpencodeAuth({
        platform: 'win32',
        env: winEnv({ localAppData: local, userProfile: profile }),
      })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(true)
      expect(result.codexHome).toBe(join(profile, '.local', 'share', 'opencode'))
    } finally {
      rmSync(local, { recursive: true, force: true })
      rmSync(profile, { recursive: true, force: true })
    }
  })

  it('XDG_DATA_HOME 优先于 LOCALAPPDATA', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'inkdown-opencode-xdg-'))
    const local = mkdtempSync(join(tmpdir(), 'inkdown-opencode-local2-'))
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-opencode-profile2-'))
    try {
      writeAuth(xdg, JSON.stringify({ a: 1 }))
      const candidates = resolveOpencodeAuthCandidates({
        platform: 'win32',
        env: winEnv({ xdg, localAppData: local, userProfile: profile }),
      })
      expect(candidates[0]).toBe(join(xdg, 'opencode', 'auth.json'))
      const result = probeOpencodeAuth({
        platform: 'win32',
        env: winEnv({ xdg, localAppData: local, userProfile: profile }),
      })
      expect(result.looksLoggedIn).toBe(true)
    } finally {
      rmSync(xdg, { recursive: true, force: true })
      rmSync(local, { recursive: true, force: true })
      rmSync(profile, { recursive: true, force: true })
    }
  })

  it('空白文件判未登录（损坏先例）：存在但去空白后为空', () => {
    const local = mkdtempSync(join(tmpdir(), 'inkdown-opencode-blank-'))
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-opencode-blank-p-'))
    try {
      writeAuth(local, '   \n\t  \n')
      const result = probeOpencodeAuth({
        platform: 'win32',
        env: winEnv({ localAppData: local, userProfile: profile }),
      })
      expect(result.hasAuthFile).toBe(true)
      expect(result.looksLoggedIn).toBe(false)
    } finally {
      rmSync(local, { recursive: true, force: true })
      rmSync(profile, { recursive: true, force: true })
    }
  })

  it('非法 JSON / 空对象判未登录', () => {
    const local = mkdtempSync(join(tmpdir(), 'inkdown-opencode-bad-'))
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-opencode-bad-p-'))
    try {
      writeAuth(local, '{not-json')
      expect(
        probeOpencodeAuth({
          platform: 'win32',
          env: winEnv({ localAppData: local, userProfile: profile }),
        }).looksLoggedIn,
      ).toBe(false)
      writeAuth(local, '{}')
      expect(
        probeOpencodeAuth({
          platform: 'win32',
          env: winEnv({ localAppData: local, userProfile: profile }),
        }).looksLoggedIn,
      ).toBe(false)
    } finally {
      rmSync(local, { recursive: true, force: true })
      rmSync(profile, { recursive: true, force: true })
    }
  })

  it('缺失判未登录', () => {
    const local = mkdtempSync(join(tmpdir(), 'inkdown-opencode-miss-l-'))
    const profile = mkdtempSync(join(tmpdir(), 'inkdown-opencode-miss-p-'))
    try {
      const result = probeOpencodeAuth({
        platform: 'win32',
        env: winEnv({ localAppData: local, userProfile: profile }),
      })
      expect(result.hasAuthFile).toBe(false)
      expect(result.hasApiKeyEnv).toBe(false)
      expect(result.looksLoggedIn).toBe(false)
    } finally {
      rmSync(local, { recursive: true, force: true })
      rmSync(profile, { recursive: true, force: true })
    }
  })
})
