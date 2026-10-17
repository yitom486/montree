import { describe, expect, it } from 'vitest'
import { getTypstAsset, isSafeArchiveMember, TINYMIST_ASSETS, TINYMIST_VERSION } from './typst-runtime-assets'
import { TINYMIST_VERSION as SERVICE_VERSION } from '@yitom/contracts'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const { verifyTypstResource } = createRequire(import.meta.url)('./verify-typst-before-pack.cjs') as {
  verifyTypstResource: (directory: string, platform: string, arch: string) => unknown
}

describe('Typst runtime distribution', () => {
  it('selects only a supported platform and never silently ships a different architecture', () => {
    expect(TINYMIST_VERSION).toBe(SERVICE_VERSION)
    expect(getTypstAsset('win32', 'x64').executable).toBe('tinymist.exe')
    expect(getTypstAsset('darwin', 'arm64').name).toContain('aarch64-apple-darwin')
    expect(() => getTypstAsset('darwin', 'x64')).toThrow('未提供')
    expect(() => getTypstAsset('win32', 'arm64')).toThrow('未提供')
    for (const asset of Object.values(TINYMIST_ASSETS)) expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects archive traversal and absolute paths before extraction', () => {
    for (const member of ['../tinymist', '/bin/tinymist', 'a/../../tinymist', 'C:/tinymist', 'a\\tinymist', '']) {
      expect(isSafeArchiveMember(member)).toBe(false)
    }
    expect(isSafeArchiveMember('tinymist-x64/bin/tinymist')).toBe(true)
    expect(isSafeArchiveMember('./tinymist')).toBe(true)
  })
  it('refuses missing, altered or wrongly targeted resources before packaging', () => {
    const directory = mkdtempSync(join(tmpdir(), 'montree-typst-pack-'))
    try {
      expect(() => verifyTypstResource(directory, 'win32', 'x64')).toThrow('缺少')
      const bytes = Buffer.from('test fixture executable')
      const manifest = { version: '0.15.8', platform: 'win32', arch: 'x64', executable: 'tinymist.exe',
        sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest))
      writeFileSync(join(directory, 'tinymist.exe'), bytes)
      // Apache text is a tracked source file, so this check also runs before prepare:typst.
      writeFileSync(join(directory, 'LICENSE'), readFileSync('LICENSES/Tinymist.txt'))
      expect(verifyTypstResource(directory, 'win32', 'x64')).toEqual(manifest)
      expect(() => verifyTypstResource(directory, 'linux', 'x64')).toThrow('不匹配')
      expect(() => verifyTypstResource(directory, 'win32', 'arm64')).toThrow('不匹配')
      writeFileSync(join(directory, 'tinymist.exe'), 'changed')
      expect(() => verifyTypstResource(directory, 'win32', 'x64')).toThrow('校验失败')
    } finally {
      if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) rmSync(directory, { recursive: true, force: true })
    }
  })
})
