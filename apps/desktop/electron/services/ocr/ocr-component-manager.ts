import { BrowserWindow } from 'electron'
import { err, ok, type Result } from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import { IPC } from '@montree/contracts'
import type { OcrComponentStatus } from '@montree/contracts'
import {
  ensureInspectorOcrRuntime,
  isInspectorOcrRuntimeInstalled,
} from './inspector-ocr-runtime'

/**
 * OCR 组件管理（PP-OCR 识别引擎）。
 * 中英文字库内置于识别模型，无语言包概念：languages 恒为空，
 * 设置页“缺语言包”分支自然不再出现。
 */

let lastStatus: OcrComponentStatus = {
  phase: 'not-ready',
  progress: 0,
  runtimeReady: false,
  languages: [],
  missingLanguages: [],
}

let ensurePromise: Promise<Result<void, AppError>> | null = null
let cancelController: AbortController | null = null

function broadcastOcrComponentStatus(status: OcrComponentStatus): void {
  lastStatus = status
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.OCR_COMPONENT_STATUS, status)
    }
  }
}

export async function inspectOcrComponentStatus(): Promise<OcrComponentStatus> {
  const runtimeReady = await isInspectorOcrRuntimeInstalled()
  const status: OcrComponentStatus = {
    phase: runtimeReady
      ? 'ready'
      : ensurePromise
        ? 'downloading'
        : lastStatus.phase === 'error'
          ? 'error'
          : 'not-ready',
    progress: runtimeReady ? 100 : ensurePromise ? lastStatus.progress : 0,
    message: runtimeReady
      ? '识别引擎已就绪（PP-OCR 内置中英文字库，可离线识别）'
      : '首次识别前需下载识别引擎（约 110MB，一次性）',
    runtimeReady,
    languages: [],
    missingLanguages: [],
  }

  lastStatus = status
  return status
}

export function getOcrComponentStatus(): OcrComponentStatus {
  return lastStatus
}

export async function ensureOcrComponent(): Promise<Result<void, AppError>> {
  const current = await inspectOcrComponentStatus()
  if (current.phase === 'ready') {
    broadcastOcrComponentStatus(current)
    return ok(undefined)
  }

  if (ensurePromise) return ensurePromise

  ensurePromise = (async (): Promise<Result<void, AppError>> => {
    const controller = new AbortController()
    cancelController = controller
    try {
      broadcastOcrComponentStatus({
        ...current,
        phase: 'downloading',
        progress: 0,
        message: '正在下载识别引擎…',
      })
      const installed = await ensureInspectorOcrRuntime((message, progress) => {
        if (controller.signal.aborted) return
        broadcastOcrComponentStatus({
          phase: 'downloading',
          progress,
          message,
          runtimeReady: false,
          languages: [],
          missingLanguages: [],
        })
      }, controller.signal)

      if (!installed.ok) {
        if (installed.error.code === 'CANCELLED') {
          const cancelled = await inspectOcrComponentStatus()
          broadcastOcrComponentStatus(cancelled)
          return err({ code: 'CANCELLED', message: '已取消下载' })
        }
        throw new Error(installed.error.message)
      }

      const ready = await inspectOcrComponentStatus()
      broadcastOcrComponentStatus(ready)
      return ok(undefined)
    } catch (cause) {
      const failed: OcrComponentStatus = {
        ...(await inspectOcrComponentStatus()),
        phase: 'error',
        message: cause instanceof Error ? cause.message : 'OCR 组件安装失败',
      }
      broadcastOcrComponentStatus(failed)
      return err({
        code: 'OCR_FAILED',
        message: failed.message ?? 'OCR 组件安装失败',
      })
    } finally {
      cancelController = null
    }
  })().finally(() => {
    ensurePromise = null
  })

  return await ensurePromise
}

export async function cancelOcrComponentDownload(): Promise<OcrComponentStatus> {
  cancelController?.abort()
  cancelController = null
  const status = await inspectOcrComponentStatus()
  broadcastOcrComponentStatus(status)
  return status
}
