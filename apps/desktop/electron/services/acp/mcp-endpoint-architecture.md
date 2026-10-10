# MCP 本地端点架构与冷门固定端口设计

本文档说明 Montree 进程内 MCP（Model Context Protocol）HTTP 服务端点的端口分配策略、冲突弹性容错与鉴权令牌稳定性机制。

---

## 1. 背景与根因

在引入固定端口之前，Montree 的进程内 MCP 服务采用 `server.listen(0, '127.0.0.1')` 由操作系统动态分配临时端口（通常落在 49152~65535 范围）：

1. **端口漂移与长会话脱节**：
   - 在开发调试热重载（HMR / 主进程重载）或应用短暂重启后，MCP 服务重新分配了新的随机端口（例如从 `61177` 变为 `59783`）。
   - 外部 Agent 运行时（如 Antigravity CLI / Codex 等 ACP 会话）在其现有会话内仍然保持最初的连接配置，后续发起工具调用时发往旧端口，被系统网络栈直接以 `connectex: No connection could be made because the target machine actively refused it` 拒绝。
2. **鉴权令牌重置隐患**：
   - 若每次启动随机生成 `authToken`，即便端口保持不变，旧会话重发请求也会遭遇 `401 Unauthorized` 鉴权拦截。

---

## 2. 端口分配策略

为彻底根治端口漂移，Montree 采用了**冷门注册端口 + 弹性顺延 + 动态安全降级**的三级策略：

| 服务端点 | 默认固定端口 | 环境变量覆盖 | 说明 |
|----------|--------------|--------------|------|
| 主 MCP 服务 (`montree`) | **`39281`** | `MONTREE_MCP_PORT` | 提供正文快照、选区读取、书签批注等核心阅读/编辑工具 |
| 目录副服务 (`montree-toc`) | **`39291`** | `MONTREE_TOC_MCP_PORT` | 目录副会话专用大纲分析工具（独立端点挂载） |

### 选段考量
- 位于 `1024~49151`（IANA 注册端口段），避开了现代操作系统（Windows/Linux/macOS）的动态出站临时端口范围（49152~65535），不会被其他出站 socket 随机占用。
- 远离前端与开发常见端口（如 3000、5173、8000、8080、9229 等），日常开发极难发生冲突。

---

## 3. 容错与弹性重试（`listenWithFallback`）

当检测到端口已被占用（`EADDRINUSE`，如用户双开多实例，或旧进程处于 TIME_WAIT 尚未彻底回收）：
1. **自动顺延递增**：依次递增探测接下来的 5 个相邻端口（例如 `39281 → 39282 → ...`）。
2. **安全降级保底**：若连续重试均被占用，自动回落至动态端口 `0`（由操作系统分配空闲端口），确保 MCP 服务永远不会崩溃阻断主进程。

---

## 4. 窗口归属与鉴权 Token

- **窗口独立端点**：主服务和目录副服务按窗口异步上下文保存句柄；同时启动合并为同一请求。端口占用时按上述策略顺延，各窗口不会共享同一个服务。
- **独立令牌**：生产窗口端点使用随机令牌，避免旧进程或其他窗口在端口复用后继续访问。兼容的无窗口调用保留 `getOrCreateAuthToken`，在当前用户临时目录存储 `montree-mcp-<label>-token.txt`。
- **仅限回环地址**：服务仅监听 `127.0.0.1`，外部局域网不可见；临时文件受操作系统用户权限保护。
- **固定归属**：HTTP 回调绑定启动窗口，文档快照和截图只发到该窗口，关闭后不回退到聚焦窗口。新建或恢复 Agent 会话时重新下发所属窗口的 MCP 配置；窗口关闭只清理自己的端点与子进程。

---

## 5. 代码与测试入口

- 核心实现：[`apps/desktop/electron/services/acp/mcp/montree-mcp-server.ts`](./mcp/montree-mcp-server.ts)
- 单元测试：[`apps/desktop/electron/services/acp/mcp/montree-mcp-server.test.ts`](./mcp/montree-mcp-server.test.ts)
- 会话消费：[`apps/desktop/electron/services/acp/acp-session-ops.ts`](./acp-session-ops.ts) 与 [`apps/desktop/electron/services/acp/acp-connection.ts`](./acp-connection.ts)
