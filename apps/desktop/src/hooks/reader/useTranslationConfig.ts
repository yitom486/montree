import { useMutation, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/query-keys'
import { prepareTranslationConfig } from '@/lib/agent/translation-session'
import { TRANSLATION_LOWEST_THOUGHT, translationModelOption, translationThoughtOption } from '@/lib/agent/translation-config'
import { authenticateTranslation, retryTranslationAuthentication, TranslationAuthRequiredError } from '@/lib/agent/translation-transport'
import { useAppSettingsStore } from '@/stores/app-settings-store'

export function useTranslationConfig(open: boolean) {
  const runtimeId = useAppSettingsStore((state) => state.translationRuntimeId)
  const model = useAppSettingsStore((state) => state.translationModelByRuntime[runtimeId] ?? '')
  const thought = useAppSettingsStore((state) => state.translationThoughtByRuntime[runtimeId] || TRANSLATION_LOWEST_THOUGHT)
  const query = useQuery({
    queryKey: queryKeys.translationConfig(runtimeId, model, thought),
    queryFn: () => prepareTranslationConfig({ runtimeId, model, thought }),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  })
  const authentication = useMutation({
    mutationFn: (methodId: string) => authenticateTranslation(runtimeId, methodId),
    onSuccess: () => { void query.refetch() },
  })
  const options = query.data ?? []
  return {
    runtimeId, model, thought,
    modelOption: translationModelOption(options),
    thoughtOption: translationThoughtOption(options),
    loading: query.isFetching,
    ready: Boolean(query.data) && !query.isFetching && !query.error,
    error: query.error?.message,
    authMethods: query.error instanceof TranslationAuthRequiredError ? query.error.methods : undefined,
    authenticate: authentication.mutate,
    authenticating: authentication.isPending,
    authError: authentication.error?.message,
    refresh: () => {
      retryTranslationAuthentication(runtimeId)
      return query.refetch()
    },
  }
}
