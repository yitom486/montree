import { useQuery } from '@tanstack/react-query'
import { fileApi } from '@/api/file-api'
import { queryKeys } from '@/api/query-keys'
import { isOk } from '@yitom/contracts'
import type { AppError } from '@yitom/contracts'

export function useReaderBinary(filePath?: string) {
  return useQuery({
    queryKey: queryKeys.readBinary(filePath ?? ''),
    queryFn: async () => {
      const result = await fileApi.readBinaryFile(filePath!)
      if (!isOk(result)) {
        throw result.error
      }
      return result.value
    },
    enabled: Boolean(filePath),
    staleTime: Infinity,
    retry: false,
  })
}
