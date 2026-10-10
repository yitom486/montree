/**
 * ACP 客户端门面（Facade）。
 *
 * 实际逻辑已模块化拆解至同目录专职模块中：
 * - `acp-context.ts` / `acp-state.ts`：窗口异步上下文与状态（connection/sessionId/runtimeId/status/监听器）+ setStatus/订阅/getter
 * - `acp-bridges.ts`：permission/snapshot bridge setter + handlePermissionRequest/handleSnapshotRequest + emitSessionUpdate + safe* 守卫/parseAuthMethods/toProtocolError/requireAgent
 * - `acp-connection.ts`：connectAcp/disconnectAcp/authenticateAcp + watchProcessExit + 代际守卫 + openSessionAfterAuth
 * - `acp-session-ops.ts`：createAcpSession/loadAcpSession/promptAcp/cancelAcp/setAcpConfigOption/disposeAllAcp
 *
 * 保留本文件以 100% 向后兼容既有引用与单元测试。
 */

export * from './acp-state'
export * from './acp-bridges'
export * from './acp-connection'
export * from './acp-session-ops'

export {
  ensureAgentSandboxCwd,
  resolveAgentCwd,
  type AgentCwdSource,
  type ResolvedAgentCwd,
} from './agent-sandbox-cwd'
