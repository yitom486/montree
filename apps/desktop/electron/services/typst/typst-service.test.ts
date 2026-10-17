import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inside, localAbsolute, TypstService } from './typst-service'

describe('Typst path and runtime boundaries', () => {
  it('rejects relative, remote/UNC and NUL paths', () => {
    for (const value of ['relative.typ', '\\\\server\\share\\test.typ', '//server/share/test.typ', 'ssh://host/test.typ', '\0bad']) expect(() => localAbsolute(value)).toThrow()
    const root = path.resolve('workspace')
    expect(inside(root, path.join(root, '文件.typ'))).toBe(true)
    expect(inside(root, path.resolve('workspace-other', 'test.typ'))).toBe(false)
    expect(inside(root, path.join(root, '..', 'test.typ'))).toBe(false)
  })
  it('reports missing tools and rejects corrupt bundled manifests before execution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'montree-typst-manifest-'))
    const executable = path.join(root, process.platform === 'win32' ? 'tinymist.exe' : 'tinymist')
    const service = new TypstService({ userData: root, bundledExecutable: executable, emit: () => {} })
    try {
      expect(await service.status()).toMatchObject({ available: false, version: null })
      await writeFile(executable, 'not executable')
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: '0.15.8', platform: process.platform, arch: process.arch, executable: path.basename(executable), size: 14, sha256: 'invalid' }))
      expect(await service.status()).toMatchObject({ available: false, message: 'Typst 随包运行时校验失败' })
    } finally { service.disposeAll(); await rm(root, { recursive: true, force: true }) }
  })
})
