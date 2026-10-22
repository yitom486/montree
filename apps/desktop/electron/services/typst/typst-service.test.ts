import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inside, localAbsolute, runtimeVersion, TypstService } from './typst-service'

describe('Typst path and runtime boundaries', () => {
  it('accepts missing Linux build metadata only for a verified bundle and preserves explicit mismatches', () => {
    const linux = 'tinymist \nBuild Git Describe:  VERGEN_IDEMPOTENT_OUTPUT\nTypst Version: 0.15.1\n'
    expect(runtimeVersion(linux)).toBeNull()
    expect(runtimeVersion(linux, '0.15.8')).toBe('0.15.8')
    expect(runtimeVersion('tinymist 0.15.7', '0.15.8')).toBe('0.15.7')
    expect(runtimeVersion('tinymist \nBuild Git Describe: v0.15.8\n')).toBe('0.15.8')
    expect(runtimeVersion('some other tool\nBuild Git Describe: VERGEN_IDEMPOTENT_OUTPUT\n', '0.15.8')).toBeNull()
    expect(runtimeVersion('tinymist \nTypst Version: 0.15.1\n', '0.15.8')).toBeNull()
  })
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

describe('Typst 按需运行时', () => {
  it('未随包时 status 提示自动下载；打开项目前先下载并推送进度', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'montree-typst-lazy-'))
    const events: unknown[] = []
    let installs = 0
    const service = new TypstService({
      userData: root, bundledExecutable: path.join(root, 'missing', 'tinymist'), emit: (_owner, event) => events.push(event),
      runtime: { installed: async () => null, expectedPath: path.join(root, 'dl', 'tinymist'), install: async (onProgress) => { installs++; onProgress({ received: 5, total: 10, phase: 'download' }); throw new Error('offline') } },
    })
    try {
      expect((await service.status()).message).toMatch(/首次打开 Typst 文件时会自动下载/)
      await expect((service as unknown as { createProject: (o: number, r: string, c: unknown) => Promise<unknown> }).createProject(7, root, {})).rejects.toThrow(/下载失败：offline/)
      expect(installs).toBe(1)
      expect(events).toEqual([
        expect.objectContaining({ method: 'montree/runtimeDownload', params: { received: 5, total: 10, phase: 'download' } }),
        expect.objectContaining({ method: 'montree/runtimeDownload', params: { phase: 'error', message: 'offline' } }),
      ])
    } finally { service.disposeAll(); await rm(root, { recursive: true, force: true }) }
  })
})
