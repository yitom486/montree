# components/ai-elements

社区 AI 展示组件的手动接入目录（不跑 `ai-elements` 安装器，不覆盖 `ui/`）。

| 文件 | 功能 |
|------|------|
| `tool.tsx` | AI Elements `Tool` 折叠组合：`Tool` / `ToolHeader` / `ToolContent` / `ToolInput` / `ToolOutput` + 中文状态徽标（`ToolStateIcon` / `getToolStateBadge` / `AiToolState`） |

来源：Vercel AI Elements（MIT），组合结构对照 https://elements.ai-sdk.dev/components/tool
（2026-10-11 核对）。本目录是照文档组合的手动实现，非 registry 逐字复制；
未运行 `ai-elements` 安装器，未安装该包，故无可 pin 的上游版本号/commit，
以核对日期与本文档的差异说明为准。AI SDK 的 `ToolUIPart` / `useChat` / 网关不接入；
ACP 状态 → `AiToolState` 的映射只发生在 `AgentToolCallCard` 边界。
依赖零新增：复用已有 `radix-ui`（Collapsible）、`lucide-react`、`cn()`。

增删或改名后，同步上级 [`../README.md`](../README.md) 与 [`../agent/README.md`](../agent/README.md) 的引用。
