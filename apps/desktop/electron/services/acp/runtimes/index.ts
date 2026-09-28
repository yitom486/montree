/**
 * ACP 运行时适配器矩阵（门面）。
 * 核心适配器实现与解析已下沉到 `@inkdown/acp`，此处提供完全重导出与兼容别名。
 */
export {
  type GenericRuntimeAdapter,
  type AcpRuntimeAdapter,
  getAcpRuntimeAdapter,
  codexAdapter,
  claudeAdapter,
  geminiAdapter,
  copilotAdapter,
  opencodeAdapter,
  cursorAdapter,
  deepseekAdapter,
  agyAdapter,
} from '@inkdown/acp'

export * from './codex'
export * from './claude'
export * from './gemini'
export * from './copilot'
export * from './opencode'
export * from './cursor'
export * from './deepseek'
export * from './agy'
