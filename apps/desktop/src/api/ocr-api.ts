import type {
  DetectPdfTocPagesPayload,
  DetectPdfTocPagesResult,
  GetPdfOcrPagePayload,
  GetPdfOcrTocPayload,
  ListPdfOcrPagesPayload,
  PdfOcrPageCache,
  PdfOcrTocCache,
  RecognizePdfPagePayload,
  RecognizePdfTocPayload,
  SavePdfOcrTocPayload,
  OcrComponentStatus,
} from '@montree/contracts'
import type { AppError } from '@montree/contracts'
import type { Result } from '@montree/contracts'

function api() {
  if (!window.electronAPI) {
    throw new Error('electronAPI 不可用')
  }
  return window.electronAPI
}

export function getPdfOcrToc(
  payload: GetPdfOcrTocPayload,
): Promise<Result<PdfOcrTocCache, AppError>> {
  return api().getPdfOcrToc(payload)
}

export function recognizePdfOcrToc(
  payload: RecognizePdfTocPayload,
): Promise<Result<PdfOcrTocCache, AppError>> {
  return api().recognizePdfOcrToc(payload)
}

export function detectPdfTocPages(
  payload: DetectPdfTocPagesPayload,
): Promise<Result<DetectPdfTocPagesResult, AppError>> {
  return api().detectPdfTocPages(payload)
}

export function deletePdfOcrToc(
  payload: GetPdfOcrTocPayload,
): Promise<Result<void, AppError>> {
  return api().deletePdfOcrToc(payload)
}

export function getPdfOcrPage(
  payload: GetPdfOcrPagePayload,
): Promise<Result<PdfOcrPageCache, AppError>> {
  return api().getPdfOcrPage(payload)
}

export function recognizePdfOcrPage(
  payload: RecognizePdfPagePayload,
): Promise<Result<PdfOcrPageCache, AppError>> {
  return api().recognizePdfOcrPage(payload)
}

export function listPdfOcrPages(
  payload: ListPdfOcrPagesPayload,
): Promise<Result<number[], AppError>> {
  return api().listPdfOcrPages(payload)
}

export function clearPdfOcrCache(
  payload: GetPdfOcrTocPayload,
): Promise<Result<void, AppError>> {
  return api().clearPdfOcrCache(payload)
}

export function clearAllPdfOcrCache(): Promise<Result<void, AppError>> {
  return api().clearAllPdfOcrCache()
}

export function savePdfOcrToc(
  payload: SavePdfOcrTocPayload,
): Promise<Result<void, AppError>> {
  return api().savePdfOcrToc(payload)
}

export function getOcrComponentStatus(): Promise<Result<OcrComponentStatus, AppError>> {
  return api().getOcrComponentStatus()
}

export function ensureOcrComponent(): Promise<Result<void, AppError>> {
  return api().ensureOcrComponent()
}

export function cancelOcrComponentDownload(): Promise<Result<OcrComponentStatus, AppError>> {
  return api().cancelOcrComponentDownload()
}

export function onOcrComponentStatus(
  callback: (status: OcrComponentStatus) => void,
): (() => void) | undefined {
  return api().onOcrComponentStatus(callback)
}
