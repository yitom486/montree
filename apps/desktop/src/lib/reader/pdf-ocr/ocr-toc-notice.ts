import type { OcrTocCacheAssessment } from '@montree/ocr-core'

/**
 * OCR 目录缓存状态的独立 UI 状态（不复用普通 outlineNotice）。
 *
 * 背景：suspect/legacy 恢复时曾把提示写进 outlineNotice，但它传给侧栏时
 * `outlineSource === 'ocr'` 即被置空——用户不打开侧栏就永远看不到。
 * 这里的状态一律画在主界面：invalid 跟 OCR 横幅走（横幅就是识别入口），
 * suspect/legacy/fresh 走独立 slim 状态条（带校正目录/重新识别按钮）。
 */
export interface OcrTocNotice {
  kind: 'suspect' | 'legacy' | 'invalid' | 'fresh'
  message: string
}

/** 重开恢复：usable 无提示；其余按状态给提示（调用方负责展示位置，见 placeOcrTocNotice） */
export function noticeForRestoredCache(
  assessment: OcrTocCacheAssessment,
): OcrTocNotice | null {
  if (assessment.status === 'usable') return null
  if (assessment.status === 'invalid') {
    return {
      kind: 'invalid',
      message: `已存目录缓存不可用（${assessment.reasons[0] ?? '结构错误'}），请重新识别`,
    }
  }
  if (assessment.status === 'legacy') {
    return {
      kind: 'legacy',
      message: `目录缓存为旧版（${assessment.reasons[0] ?? '缺少来源记录'}），可继续阅读，建议打开校正目录核对后保存确认`,
    }
  }
  return {
    kind: 'suspect',
    message: `目录可能不完整（${assessment.reasons[0] ?? '未经人工确认'}），建议重新识别或打开校正目录核对`,
  }
}

/** 自动识别当次：结果即 suspect，当场提示核对入口（非阻塞，可继续阅读） */
export function noticeForFreshRecognize(entryCount: number): OcrTocNotice {
  return {
    kind: 'fresh',
    message: `已自动识别 ${entryCount} 条目录，可继续阅读，建议打开校正目录核对后保存`,
  }
}

export interface PlacedOcrTocNotice {
  /** 主横幅内的附加原因行（invalid 且横幅可见时）；侧栏无关 */
  bannerExtra: string | null
  /** 独立 slim 状态条（不打开侧栏也可见，带校正/重识按钮） */
  statusBar: OcrTocNotice | null
}

/**
 * 展示位置裁决：invalid 不进 OCR 侧栏，原因跟横幅走（横幅本身就是识别入口）；
 * suspect/legacy/fresh 已是 OCR 目录，走独立状态条（横幅此时隐藏）。
 */
export function placeOcrTocNotice(
  notice: OcrTocNotice | null,
  outlineSource: string,
): PlacedOcrTocNotice {
  if (!notice) return { bannerExtra: null, statusBar: null }
  if (notice.kind === 'invalid') {
    return { bannerExtra: notice.message, statusBar: null }
  }
  if (outlineSource === 'ocr') {
    return { bannerExtra: null, statusBar: notice }
  }
  return { bannerExtra: null, statusBar: null }
}
