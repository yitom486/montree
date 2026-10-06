import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeCodexAuth } from './codex-auth-preflight'

const saved = {
  CODEX_HOME: process.env.CODEX_HOME,
  CODEX_API_KEY: process.env.CODEX_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('probeCodexAuth', () => {
  it('returns boolean fields without throwing', () => {
    const result = probeCodexAuth()
    expect(result.codexHome.length).toBeGreaterThan(0)
    expect(typeof result.hasCodexHome).toBe('boolean')
    expect(typeof result.hasAuthFile).toBe('boolean')
    expect(typeof result.hasApiKeyEnv).toBe('boolean')
    expect(result.looksLoggedIn).toBe(result.hasAuthFile || result.hasApiKeyEnv)
  })

  it('detects auth.json under CODEX_HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'montree-codex-'))
    writeFileSync(join(home, 'auth.json'), '{}', 'utf8')
    process.env.CODEX_HOME = home
    delete process.env.CODEX_API_KEY
    delete process.env.OPENAI_API_KEY

    const result = probeCodexAuth()
    expect(result.hasAuthFile).toBe(true)
    expect(result.looksLoggedIn).toBe(true)

    rmSync(home, { recursive: true, force: true })
  })

  it('no auth.json and no env key → not logged in', () => {
    const home = mkdtempSync(join(tmpdir(), 'montree-codex-empty-'))
    mkdirSync(home, { recursive: true })
    process.env.CODEX_HOME = home
    delete process.env.CODEX_API_KEY
    delete process.env.OPENAI_API_KEY

    const result = probeCodexAuth()
    expect(result.hasAuthFile).toBe(false)
    expect(result.hasApiKeyEnv).toBe(false)
    expect(result.looksLoggedIn).toBe(false)

    rmSync(home, { recursive: true, force: true })
  })
})
