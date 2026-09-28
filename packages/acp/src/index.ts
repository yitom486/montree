/**
 * @inkdown/acp — Headless Agent Client Protocol SDK
 * 
 * 完整的 ACP 客户端协议栈，包含：
 * - runtimes: 8 大主流 Agent 运行时（Codex, Claude, Cursor, DeepSeek, Gemini, Copilot, OpenCode, Agy）
 * - process: 跨平台子进程生命周期、级联 kill 与温进程池复用
 * - client: 独立的 AcpClient 客户端、会话状态机、stdio 桥接与通用回调
 * - auth: 统一认证守门员、密钥探测与 CODEX_HOME 隔离
 * - mcp: 内置与外挂 MCP 工具表定义与 RPC 注册
 * - session: 运行时配置、能力协商与会话注册表
 * - transport: stdio 缓冲与终端输出处理
 */

// ── 核心常量与共享契约重导出 ──
export * from "./contracts";

// ── 核心客户端与会话 ──
export * from "./client/acp-client";
export * from "./client/sdk-client";
export * from "./client/session-open";
export * from "./client/client-handlers";
export * from "./client/acp-proxy-service";
export * from "./client/acp-paths";
export * from "./client/acp-fs";
export * from "./client/acp-terminal";

// ── 进程管理 ──
export * from "./process/process-manager";

// ── Agent 运行时矩阵 ──
export * from "./runtimes";

// ── 传输 ──
export * from "./transport/terminal-output-buffer";

// ── 认证协议通用门限 ──
export * from "./auth/auth-method-order";
export * from "./auth/connect-auth-decision";
export * from "./auth/connect-auth-gate";

// ── 会话 ──
export * from "./session/agent-registry";
export * from "./session/config-options";
export * from "./session/session-capabilities";

// ── MCP ──
export * from "./mcp/inkdown-mcp-tools";
export * from "./mcp/inkdown-mcp-toc-tools";
export * from "./mcp/inkdown-mcp-rpc";
