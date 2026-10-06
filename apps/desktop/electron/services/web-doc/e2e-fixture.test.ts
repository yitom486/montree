import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isOk } from '@montree/contracts'
import {
  E2E_WEB_DOC_FIXTURE_HOST,
  resetE2eWebDocFixtureCache,
  tryFetchE2eWebDocFixture,
} from './e2e-fixture'

describe('e2e web-doc fixture', () => {
  let tempDir = ''
  const startUrl = `https://${E2E_WEB_DOC_FIXTURE_HOST}/docs/start`

  beforeEach(async () => {
    resetE2eWebDocFixtureCache()
    tempDir = await mkdtemp(join(tmpdir(), 'web-doc-fixture-'))
    await writeFile(
      join(tempDir, 'manifest.json'),
      JSON.stringify({ [startUrl]: 'start.html' }),
      'utf-8',
    )
    await writeFile(
      join(tempDir, 'start.html'),
      '<!DOCTYPE html><html><body><article><h1>Fixture</h1></article></body></html>',
      'utf-8',
    )
    process.env.E2E_WEB_DOC_FIXTURE_DIR = tempDir
  })

  afterEach(() => {
    delete process.env.E2E_WEB_DOC_FIXTURE_DIR
    resetE2eWebDocFixtureCache()
    tempDir = ''
  })

  it('命中 manifest 时返回本地 HTML', async () => {
    const result = await tryFetchE2eWebDocFixture(startUrl)
    expect(result).not.toBeNull()
    expect(isOk(result!)).toBe(true)
    if (!result || !isOk(result)) return
    expect(result.value.html).toContain('<h1>Fixture</h1>')
  })

  it('未配置 URL 返回错误', async () => {
    const result = await tryFetchE2eWebDocFixture(`https://${E2E_WEB_DOC_FIXTURE_HOST}/docs/missing`)
    expect(result).not.toBeNull()
    expect(result!.ok).toBe(false)
  })

  it('非 fixture 域名返回 null', async () => {
    const result = await tryFetchE2eWebDocFixture('https://react.dev/learn')
    expect(result).toBeNull()
  })

  it('未设置环境变量时返回 null', async () => {
    delete process.env.E2E_WEB_DOC_FIXTURE_DIR
    resetE2eWebDocFixtureCache()
    const result = await tryFetchE2eWebDocFixture(startUrl)
    expect(result).toBeNull()
  })
})
