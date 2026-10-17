import type { MontreePresentResult } from '@yitom/contracts'

export type PresentLocateVerdict = { ok: true } | { ok: false; message: string }

function baseNameOf(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath
}

/**
 * 比较卡定位前文档归属校验（P1）：结果绑定的来源指纹必须与当前活动文档一致。
 * 不一致/无当前文档时禁止导航，给出明确引导（打开原文档），避免操作错误文档。
 */
export function checkPresentDocument(
  result: Pick<MontreePresentResult, 'documentFingerprint' | 'documentLabel'>,
  currentFilePath: string | null | undefined,
): PresentLocateVerdict {
  const origin = result.documentFingerprint?.trim()
  if (!origin) {
    return { ok: false, message: '该结果未绑定来源文档，无法定位；请重新生成比较卡后再试' }
  }
  if (!currentFilePath?.trim()) {
    return {
      ok: false,
      message: `该结果来自《${result.documentLabel ?? origin}》，当前没有打开的文档，请先打开原文档后再定位`,
    }
  }
  if (currentFilePath.trim() !== origin) {
    return {
      ok: false,
      message: `该结果来自《${result.documentLabel ?? origin}》，当前打开的是《${baseNameOf(currentFilePath)}》，请先打开原文档后再定位`,
    }
  }
  return { ok: true }
}
