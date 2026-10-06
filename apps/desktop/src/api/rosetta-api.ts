import type { AppError } from '@montree/contracts'
import { err, type Result } from '@montree/contracts'
import type {
  RosettaActiveImport,
  RosettaBodyWatermarkApplyPayload,
  RosettaBodyWatermarkApplyResult,
  RosettaBodyWatermarkPreviewPayload,
  RosettaBodyWatermarkPreviewResult,
  RosettaBookInfo,
  RosettaImportPayload,
  RosettaImportStats,
  RosettaImportStatus,
  RosettaInspectContentPayload,
  RosettaInspectContentResult,
  RosettaQuery,
  RosettaQueryResult,
  RosettaTocRebuildPayload,
  RosettaTocRebuildResult,
} from '@montree/contracts'

function getElectronAPI() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export const rosettaApi = {
  /** 扫描书一键导入罗盘索引（长任务；进度走 onRosettaImportStatus） */
  async importBook(payload: RosettaImportPayload): Promise<Result<RosettaImportStats, AppError>> {
    const api = getElectronAPI()
    if (!api?.importBookToRosetta) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘导入 API 不可用' })
    }
    return api.importBookToRosetta(payload)
  },

  cancelImport(): void {
    getElectronAPI()?.cancelRosettaImport()
  },

  onImportStatus(callback: (status: RosettaImportStatus) => void): (() => void) | undefined {
    return getElectronAPI()?.onRosettaImportStatus(callback)
  },

  async getBookInfo(fingerprint: string): Promise<Result<RosettaBookInfo | null, AppError>> {
    const api = getElectronAPI()
    if (!api?.getRosettaBookInfo) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.getRosettaBookInfo(fingerprint)
  },

  /** 查询当前导入快照（窗口重载后恢复进度显示），无则返回 null */
  async getActiveImport(): Promise<Result<RosettaActiveImport | null, AppError>> {
    const api = getElectronAPI()
    if (!api?.getActiveRosettaImport) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.getActiveRosettaImport()
  },

  async queryBook(query: RosettaQuery): Promise<Result<RosettaQueryResult, AppError>> {
    const api = getElectronAPI()
    if (!api?.queryRosettaBook) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.queryRosettaBook(query)
  },

  /** 纯本地重建罗盘目录索引（不调 OCR，调用方传入已确认目录） */
  async rebuildToc(
    payload: RosettaTocRebuildPayload,
  ): Promise<Result<RosettaTocRebuildResult, AppError>> {
    const api = getElectronAPI()
    if (!api?.rebuildRosettaToc) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.rebuildRosettaToc(payload)
  },

  /** 只读预览正文水印清洗（不写库，最多 20 条样例） */
  async previewBodyWatermark(
    payload: RosettaBodyWatermarkPreviewPayload,
  ): Promise<Result<RosettaBodyWatermarkPreviewResult, AppError>> {
    const api = getElectronAPI()
    if (!api?.previewBodyWatermark) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.previewBodyWatermark(payload)
  },

  /**
   * 备份并应用正文水印清洗（须用户二次确认后调用；空计划返回 noop）。
   * 确认前绝不调用：调用方须先展示签名/统计，确认后才调本方法。
   */
  async applyBodyWatermark(
    payload: RosettaBodyWatermarkApplyPayload,
  ): Promise<Result<RosettaBodyWatermarkApplyResult, AppError>> {
    const api = getElectronAPI()
    if (!api?.applyBodyWatermark) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.applyBodyWatermark(payload)
  },

  /**
   * 已入库内容只读取证（指纹须为当前打开文档，调用方不得自带任意指纹）。
   * 未入库/参数错误返回错误，不建库、不迁移、不 OCR。
   */
  async inspectContent(
    payload: RosettaInspectContentPayload,
  ): Promise<Result<RosettaInspectContentResult, AppError>> {
    const api = getElectronAPI()
    if (!api?.inspectRosettaContent) {
      return err({ code: 'API_UNAVAILABLE', message: '罗盘查询 API 不可用' })
    }
    return api.inspectRosettaContent(payload)
  },
}
