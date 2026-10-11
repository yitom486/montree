import { mkdtemp, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentHash, saveBinaryDocument } from './binary-document-service'
import { zipSync, strToU8 } from 'fflate'
import { runInNewContext } from 'node:vm'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const directories: string[] = []
afterEach(async () => { vi.clearAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
describe('Office 保存', () => {
  for (const scenario of ['短暂占用', '持续占用', '重试期间外部修改'] as const) {
    it(`${scenario}：有界重试，保留错误和外部文件，清理临时文件`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'montree-binary-retry-')); directories.push(directory)
      const filePath = join(directory, 'book.xlsx')
      const original = zipSync({ 'a.xml': strToU8('<old/>') })
      const changed = zipSync({ 'a.xml': strToU8('<new/>') })
      const external = zipSync({ 'a.xml': strToU8('<external/>') })
      await writeFile(filePath, original)
      const busy = Object.assign(new Error('目标文件占用'), { code: 'EPERM', syscall: 'rename' })
      if (scenario === '持续占用') {
        for (let i = 0; i < 4; i++) vi.mocked(rename).mockRejectedValueOnce(busy)
      } else {
        vi.mocked(rename).mockImplementationOnce(async () => {
          if (scenario === '重试期间外部修改') await writeFile(filePath, external)
          throw busy
        })
      }
      const result = await saveBinaryDocument({ filePath, data: changed, expectedHash: documentHash(original) })
      if (scenario === '短暂占用') {
        expect(result).toMatchObject({ ok: true })
        expect(new Uint8Array(await readFile(filePath))).toEqual(changed)
        expect(rename).toHaveBeenCalledTimes(2)
      } else {
        expect(result).toMatchObject({ ok: false, error: { code: scenario === '持续占用' ? 'EPERM' : 'INVALID_STATE' } })
        expect(new Uint8Array(await readFile(filePath))).toEqual(scenario === '持续占用' ? original : external)
        expect(rename).toHaveBeenCalledTimes(scenario === '持续占用' ? 4 : 1)
      }
      expect(await readdir(directory)).toEqual(['book.xlsx'])
    })
  }
  it('摘要匹配才写入；外部修改后拒绝覆盖并清理临时文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'montree-binary-test-')); directories.push(directory)
    const filePath = join(directory, 'book.xlsx')
    const original = zipSync({ 'a.xml': strToU8('<old/>') }); const changed = zipSync({ 'a.xml': strToU8('<new/>') })
    await writeFile(filePath, original)
    const transferred = runInNewContext('new Uint8Array(bytes)', { bytes: Array.from(changed) }) as Uint8Array
    const first = await saveBinaryDocument({ filePath, data: transferred, expectedHash: documentHash(original) })
    expect(first, `首次保存结果：${JSON.stringify(first)}`).toMatchObject({ ok: true })
    expect(new Uint8Array(await readFile(filePath))).toEqual(changed)
    const conflict = await saveBinaryDocument({ filePath, data: original, expectedHash: documentHash(original) })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error.code).toBe('INVALID_STATE')
    expect(new Uint8Array(await readFile(filePath))).toEqual(changed)
    expect(await readdir(directory)).toEqual(['book.xlsx'])
  })
  it('不允许以Office工具保存任意文本格式或非ZIP数据', async () => {
    expect((await saveBinaryDocument({ filePath: '/a.md', data: new Uint8Array([80, 75, 1, 2]), expectedHash: 'a'.repeat(64) })).ok).toBe(false)
    expect((await saveBinaryDocument({ filePath: '/a.xlsx', data: strToU8('notzip'), expectedHash: 'a'.repeat(64) })).ok).toBe(false)
  })
})
