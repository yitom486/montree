# @montree/remote-server

workspace Node 远端服务（A2）：纯 JavaScript + Node-only 独立入口，
stdin/stdout 只走长度分帧协议，日志走 stderr。

| 文件 | 功能 |
|------|------|
| `src/index.ts` | barrel（不含 `entry.ts`，入口由构建脚本单独打包） |
| `src/entry.ts` | 独立入口：`--root/--session/--generation/--build` 解析、崩溃收尾、信号/EOF 退出 |
| `src/server.ts` | 帧循环 + 方法分发 + 并发上限 + 取消注册表 + session/generation 隔离 |
| `src/methods.ts` | 文件/资源/搜索/Git 方法（根归属 confine、串行安全写、revision 冲突） |
| `src/root-guard.ts` | 根真实路径归属 + 最近存在祖先还原（防穿越/symlink escape） |
| `src/watch.ts` | 原生监听注册表（400ms 合并、.git/node_modules 降噪、Linux 单层策略） |
| `src/logger.ts` | stderr 脱敏日志 |
| `src/*.test.ts` | 根归属/分发/冲突/取消单测 + 自包含 bundle Node-only 集成验证 |
| `scripts/build.ts` | Bun 自包含构建（`montree-remote-server.cjs` + `manifest.json`，`bun run build:remote-server`） |

约束（`scripts/check-deps.ts` R7）：禁止 `electron` / `node:sqlite` /
本机 DB / `@firecrawl/pdf-inspector` / `@yitom/acp-client` /
`@agentclientprotocol/*` / `scripts/`·`third-party/` 手搓 RPC；
请求 id 统一 `ws-` 命名空间，不复用 ACP 消息 ID。

协议类型与限额见 `@montree/contracts` 的 `src/types/workspace.ts`；
纯逻辑（分帧/路径/revision）见 `@montree/workspace-core`；
主进程管道客户端见 `apps/desktop/electron/services/remote/`。
