/**
 * ACP 运行时适配器矩阵（门面）。
 * 核心适配器实现与解析已下沉到 `@yitom/acp-client`；DeepSeek 的宿主预检
 * （复用 `$DSH_HOME/.credentials.yaml`）由本目录覆盖后注册，避免被 SDK
 * 内置的旧 adapter 以同名重导出遮蔽。
 */
import {
  type AcpRuntimeAdapter,
  getAcpRuntimeAdapter as getBaseAcpRuntimeAdapter,
  codexAdapter,
  claudeAdapter,
  geminiAdapter,
  copilotAdapter,
  opencodeAdapter,
  cursorAdapter,
  deepseekAdapter as baseDeepseekAdapter,
  agyAdapter,
} from '@yitom/acp-client'
import { deepseekAdapter as localDeepseekAdapter } from './deepseek'

export type { GenericRuntimeAdapter, AcpRuntimeAdapter } from '@yitom/acp-client'
export {
  codexAdapter,
  claudeAdapter,
  geminiAdapter,
  copilotAdapter,
  opencodeAdapter,
  cursorAdapter,
  agyAdapter,
} from '@yitom/acp-client'

/** DeepSeek: merge host credential-aware overrides over the SDK baseline. */
export const deepseekAdapter: AcpRuntimeAdapter = {
  ...baseDeepseekAdapter,
  ...localDeepseekAdapter,
}

/** Resolve the host-owned DeepSeek adapter first; all other ids stay on the SDK registry. */
export function getAcpRuntimeAdapter(runtimeId: string): AcpRuntimeAdapter {
  return runtimeId === 'deepseek' ? deepseekAdapter : getBaseAcpRuntimeAdapter(runtimeId)
}

export {
  buildDeepseekMissingKeyMessage,
  hasDeepseekHarnessCredentials,
  resolveDeepseekHarnessHome,
  resolveDeepseekSpawnBlocker,
  resolveDeepseekSpawnCommand,
} from './deepseek'

export * from './codex'
export * from './agy'
