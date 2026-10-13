# @montree/workspace-core

workspace 独立协议的**纯逻辑**包：零运行时导入（仅 `import type` 消费
`@montree/contracts`），可被 `electron-vite` 打进主进程，也可被 Bun 内联进
远端自包含 bundle。

| 文件 | 功能 |
|------|------|
| `src/index.ts` | barrel（重导出 `protocol`/`paths`/`revision`） |
| `src/protocol.ts` | 长度分帧编解码（u32 BE + UTF-8 JSON）、流式解码（分包/粘包/超限/异常帧）、请求信封校验、握手兼容判定、Node 版本下限判定、脱敏日志字段、`ws-` 请求 id 生成 |
| `src/paths.ts` | 工作区相对 POSIX 路径纯校验与归一化（拒绝绝对路径/盘符/`..` 穿越/NUL） |
| `src/revision.ts` | 不透明 revision token（`size:mtimeMs:hash`）拼装/解析/全等比较 |
| `src/protocol.test.ts` / `src/pure.test.ts` | 分帧/校验/握手/路径/revision 单测 |

协议细节（帧格式、握手字段、限额）见 `@montree/contracts` 的
`src/types/workspace.ts`；服务端实现见 `@montree/remote-server`。
