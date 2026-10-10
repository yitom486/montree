import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { documentHash, saveBinaryDocument } from './binary-document-service'
import { zipSync, strToU8 } from 'fflate'
import { runInNewContext } from 'node:vm'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
describe('Office 保存', () => {
  it('摘要匹配才写入；外部修改后拒绝覆盖并清理临时文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'montree-binary-test-')); directories.push(directory)
    const filePath = join(directory, 'book.xlsx')
    const original = zipSync({ 'a.xml': strToU8('<old/>') }); const changed = zipSync({ 'a.xml': strToU8('<new/>') })
    await writeFile(filePath, original)
    const transferred = runInNewContext('new Uint8Array(bytes)', { bytes: Array.from(changed) }) as Uint8Array
    const first = await saveBinaryDocument({ filePath, data: transferred, expectedHash: documentHash(original) })
    expect(first).toMatchObject({ ok: true })
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
