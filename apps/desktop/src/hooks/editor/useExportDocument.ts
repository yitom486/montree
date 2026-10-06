import { useCallback } from 'react'
import { toast } from 'sonner'
import { fileApi } from '@/api/file-api'
import { buildExportHtml, getSuggestedExportName } from '@/lib/editor/export-document'
import { reportAppError } from '@/lib/workspace/report-error'
import { isOk } from '@montree/contracts'

export function useExportDocument(content: string, filePath: string | undefined) {
  const exportHtml = useCallback(async () => {
    const html = await buildExportHtml(content, filePath)
    const result = await fileApi.exportHtml({
      html,
      suggestedName: getSuggestedExportName(filePath, 'html'),
    })

    if (!isOk(result)) {
      reportAppError(result.error)
      return
    }

    toast.success('已导出 HTML')
  }, [content, filePath])

  const exportPdf = useCallback(async () => {
    const html = await buildExportHtml(content, filePath)
    const result = await fileApi.exportPdf({
      html,
      suggestedName: getSuggestedExportName(filePath, 'pdf'),
    })

    if (!isOk(result)) {
      reportAppError(result.error)
      return
    }

    toast.success('已导出 PDF')
  }, [content, filePath])

  return { exportHtml, exportPdf }
}
