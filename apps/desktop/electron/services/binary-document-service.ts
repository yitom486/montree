import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { err, ok, toAppError, type AppError, type Result, type SaveBinaryDocumentPayload, type SaveBinaryDocumentResult } from '@yitom/contracts'

export function documentHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

const saving = new Set<string>()

/** 同目录临时文件替换；对比打开时的摘要，防止覆盖其他程序修改。 */
export async function saveBinaryDocument(payload: SaveBinaryDocumentPayload): Promise<Result<SaveBinaryDocumentResult, AppError>> {
  if (!payload || !['.xlsx', '.pptx'].includes(extname(payload.filePath ?? '').toLowerCase()) ||
    !ArrayBuffer.isView(payload.data) || Object.prototype.toString.call(payload.data) !== '[object Uint8Array]' || payload.data.length < 4 || payload.data.length > 100 * 1024 * 1024 ||
    payload.data[0] !== 0x50 || payload.data[1] !== 0x4b || !/^[a-f0-9]{64}$/.test(payload.expectedHash ?? '')) {
    return err({ code: 'INVALID_ARGUMENT', message: '无效的 Office 保存参数' })
  }
  const key = payload.filePath.toLowerCase()
  if (saving.has(key)) return err({ code: 'INVALID_STATE', message: '该文档正在保存，请稍后重试' })
  saving.add(key)
  const temporary = `${payload.filePath}.${randomUUID()}.tmp`
  try {
    const original = await readFile(payload.filePath)
    if (documentHash(original) !== payload.expectedHash) return err({ code: 'INVALID_STATE', message: '磁盘文件已被其他程序修改，请重新打开后再保存' })
    await writeFile(temporary, payload.data, { flag: 'wx' })
    // Windows 上索引器/杀毒软件可能短暂占用目标；每次重试仍校验外部修改。
    for (let attempt = 0; ; attempt++) {
      if (documentHash(await readFile(payload.filePath)) !== payload.expectedHash) return err({ code: 'INVALID_STATE', message: '保存期间磁盘文件发生变化，未覆盖文件' })
      try {
        await rename(temporary, payload.filePath)
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY')) throw error
        await delay(50 * (attempt + 1))
      }
    }
    return ok({ filePath: payload.filePath, hash: documentHash(payload.data) })
  } catch (error) {
    return err(toAppError(error, '保存 Office 文档失败'))
  } finally {
    saving.delete(key)
    await unlink(temporary).catch(() => {})
  }
}
