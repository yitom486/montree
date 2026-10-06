import { useCallback } from 'react'
import { toast } from 'sonner'
import { fileApi } from '@/api/file-api'
import { reportAppError } from '@/lib/workspace/report-error'
import { isOk } from '@montree/contracts'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('读取图片失败'))
        return
      }
      const base64 = result.split(',')[1]
      if (!base64) {
        reject(new Error('读取图片失败'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

export function usePasteImage(markdownFilePath: string | undefined) {
  const handlePasteImage = useCallback(
    async (blob: Blob, mimeType: string): Promise<string | null> => {
      if (!markdownFilePath) {
        toast.error('请先保存文档后再粘贴图片')
        return null
      }

      try {
        const base64 = await blobToBase64(blob)
        const result = await fileApi.savePastedImage({
          markdownFilePath,
          base64,
          mimeType,
        })

        if (!isOk(result)) {
          reportAppError(result.error)
          return null
        }

        toast.success('图片已保存到 assets')
        return `![image](${result.value.relativePath})`
      } catch {
        toast.error('粘贴图片失败')
        return null
      }
    },
    [markdownFilePath],
  )

  return { handlePasteImage }
}
