import {
  mkdir,
  rename,
  rm,
  writeFile,
  access,
  constants,
  cp,
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { AppError } from '@montree/contracts'
import { toAppError } from '@montree/contracts'
import { err, ok, type Result } from '@montree/contracts'
import type {
  WorkspaceFsCopyPayload,
  WorkspaceFsCreateDirPayload,
  WorkspaceFsCreateFilePayload,
  WorkspaceFsDeletePayload,
  WorkspaceFsMovePayload,
  WorkspaceFsPathResult,
  WorkspaceFsRenamePayload,
} from '@montree/contracts'

export function assertInsideWorkspace(filePath: string, workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const target = resolve(filePath)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(`路径不在工作区内: ${filePath}`)
  }
  return target
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function toResult(abs: string): WorkspaceFsPathResult {
  return { path: abs }
}

export async function workspaceCreateFile(
  payload: WorkspaceFsCreateFilePayload,
): Promise<Result<WorkspaceFsPathResult, AppError>> {
  try {
    const abs = assertInsideWorkspace(payload.path, payload.workspaceRoot)
    if (await pathExists(abs)) {
      return err({ code: 'FILE_WRITE_ERROR', message: `文件已存在：${basename(abs)}` })
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, payload.content ?? '', 'utf-8')
    return ok(toResult(abs))
  } catch (error) {
    return err(toAppError(error, '创建文件失败'))
  }
}

export async function workspaceCreateDirectory(
  payload: WorkspaceFsCreateDirPayload,
): Promise<Result<WorkspaceFsPathResult, AppError>> {
  try {
    const abs = assertInsideWorkspace(payload.path, payload.workspaceRoot)
    if (await pathExists(abs)) {
      return err({ code: 'FILE_WRITE_ERROR', message: `目录已存在：${basename(abs)}` })
    }
    await mkdir(abs, { recursive: true })
    return ok(toResult(abs))
  } catch (error) {
    return err(toAppError(error, '创建文件夹失败'))
  }
}

export async function workspaceRename(
  payload: WorkspaceFsRenamePayload,
): Promise<Result<WorkspaceFsPathResult, AppError>> {
  try {
    const from = assertInsideWorkspace(payload.fromPath, payload.workspaceRoot)
    const to = assertInsideWorkspace(payload.toPath, payload.workspaceRoot)
    if (!(await pathExists(from))) {
      return err({ code: 'FILE_NOT_FOUND', message: '源路径不存在' })
    }
    if (await pathExists(to)) {
      return err({ code: 'FILE_WRITE_ERROR', message: `目标已存在：${basename(to)}` })
    }
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
    return ok(toResult(to))
  } catch (error) {
    return err(toAppError(error, '重命名失败'))
  }
}

export async function workspaceDelete(
  payload: WorkspaceFsDeletePayload,
): Promise<Result<void, AppError>> {
  try {
    const abs = assertInsideWorkspace(payload.path, payload.workspaceRoot)
    if (resolve(abs) === resolve(payload.workspaceRoot)) {
      return err({ code: 'FILE_WRITE_ERROR', message: '不能删除工作区根目录' })
    }
    if (!(await pathExists(abs))) {
      return err({ code: 'FILE_NOT_FOUND', message: '路径不存在' })
    }
    await rm(abs, { recursive: true, force: true })
    return ok(undefined)
  } catch (error) {
    return err(toAppError(error, '删除失败'))
  }
}

export async function workspaceCopy(
  payload: WorkspaceFsCopyPayload,
): Promise<Result<WorkspaceFsPathResult, AppError>> {
  try {
    const from = assertInsideWorkspace(payload.fromPath, payload.workspaceRoot)
    const to = assertInsideWorkspace(payload.toPath, payload.workspaceRoot)
    if (!(await pathExists(from))) {
      return err({ code: 'FILE_NOT_FOUND', message: '源路径不存在' })
    }
    if (await pathExists(to)) {
      return err({ code: 'FILE_WRITE_ERROR', message: `目标已存在：${basename(to)}` })
    }
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true })
    return ok(toResult(to))
  } catch (error) {
    return err(toAppError(error, '复制失败'))
  }
}

export async function workspaceMove(
  payload: WorkspaceFsMovePayload,
): Promise<Result<WorkspaceFsPathResult, AppError>> {
  try {
    const from = assertInsideWorkspace(payload.fromPath, payload.workspaceRoot)
    const to = assertInsideWorkspace(payload.toPath, payload.workspaceRoot)
    if (!(await pathExists(from))) {
      return err({ code: 'FILE_NOT_FOUND', message: '源路径不存在' })
    }
    if (await pathExists(to)) {
      return err({ code: 'FILE_WRITE_ERROR', message: `目标已存在：${basename(to)}` })
    }
    await mkdir(dirname(to), { recursive: true })
    try {
      await rename(from, to)
    } catch {
      await cp(from, to, { recursive: true })
      await rm(from, { recursive: true, force: true })
    }
    return ok(toResult(to))
  } catch (error) {
    return err(toAppError(error, '移动失败'))
  }
}

/** 在目录下生成不冲突的副本名：a.md → a copy.md → a copy 2.md */
export function nextCopyName(fileName: string, existingNames: Set<string>): string {
  if (!existingNames.has(fileName.toLowerCase())) return fileName
  const dot = fileName.lastIndexOf('.')
  const hasExt = dot > 0
  const stem = hasExt ? fileName.slice(0, dot) : fileName
  const ext = hasExt ? fileName.slice(dot) : ''
  let i = 1
  while (true) {
    const candidate = i === 1 ? `${stem} copy${ext}` : `${stem} copy ${i}${ext}`
    if (!existingNames.has(candidate.toLowerCase())) return candidate
    i += 1
  }
}

export function joinWorkspacePath(parentDir: string, name: string): string {
  return join(parentDir, name)
}
