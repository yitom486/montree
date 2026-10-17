import { err, type AppError, type Result } from '@yitom/contracts'

export function compileReactArtifact(source: string, css?: string): Promise<Result<string, AppError>> {
  const api = window.electronAPI
  if (!api?.compileReactArtifact) return Promise.resolve(err({ code: 'API_UNAVAILABLE', message: 'React 编译环境未就绪，请重启应用' }))
  return api.compileReactArtifact({ source, css })
}
