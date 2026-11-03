import type { TranslationAPI } from '../../contracts/translation'

function api(): TranslationAPI {
  if (!window.montreeTranslation) throw new Error('翻译接口未就绪，请完全重启应用')
  return window.montreeTranslation
}

export const translationApi: TranslationAPI = {
  connect: (runtimeId) => api().connect(runtimeId),
  authenticate: (payload) => api().authenticate(payload),
  sessionNew: (payload) => api().sessionNew(payload),
  loadSession: (payload) => api().loadSession(payload),
  prompt: (payload) => api().prompt(payload),
  setConfigOption: (payload) => api().setConfigOption(payload),
  onSessionUpdate: (callback) => api().onSessionUpdate(callback),
  onStatusChanged: (callback) => api().onStatusChanged(callback),
}
