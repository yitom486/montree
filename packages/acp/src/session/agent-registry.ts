import {
  BUILTIN_ACP_RUNTIMES,
  DEFAULT_ACP_RUNTIME_ID,
  findBuiltinAcpRuntime,
} from "../contracts"
import type { AcpRuntimeInfo } from "../contracts"

export function listAcpRuntimes(): AcpRuntimeInfo[] {
  return [...BUILTIN_ACP_RUNTIMES]
}

export function getAcpRuntime(id: string): AcpRuntimeInfo | undefined {
  return findBuiltinAcpRuntime(id)
}

export function getDefaultAcpRuntime(): AcpRuntimeInfo {
  const runtime = findBuiltinAcpRuntime(DEFAULT_ACP_RUNTIME_ID)
  if (!runtime) {
    throw new Error(`缺少默认 ACP 运行时: ${DEFAULT_ACP_RUNTIME_ID}`)
  }
  return runtime
}
