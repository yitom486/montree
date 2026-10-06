import { useQuery } from '@tanstack/react-query'
import { fileApi } from '@/api/file-api'
import { queryKeys } from '@/api/query-keys'
import { isOk } from '@montree/contracts'
import type { AppError } from '@montree/contracts'

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
