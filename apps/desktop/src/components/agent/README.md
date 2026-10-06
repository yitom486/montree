# src/components/agent

ACP Agent 面板（壳自研；消息渲染可复用 Markdown/Mermaid 块）。已按渲染链分子目录（2026-09 重构）。

## 根目录：面板与接线

| 文件 | 功能 |
|------|------|
| `AgentPanel` | 右侧 Agent 主面板（壳 + 接线；配置项分类纯逻辑已出库 `lib/agent/acp-config-menu`，模型尾缀思考档只读徽标见 `lib/agent/acp-model-thinking`，fast 类 boolean 在输入栏给可见开关（`findFastToggle` 单列，不进 secondary），其余 boolean 仍在 secondary；运行时切换器全量读 `BUILTIN_ACP_RUNTIMES`，下游 8 项落地后零改动展示，非 codex 走中性认证提示） |
| `DockedAgentPane` | 阅读器内停靠态面板壳（左侧拉伸分隔线，宽持久化，三端 viewer 共用） |
| `AgentHeaderOverflowMenu` | 聊天头部 ⋯ 溢出菜单（新对话/清空/模式切换） |
| `FloatingAIHud` | 悬浮 AI 伴读浮窗与微型药丸胶囊（支持 docked / floating / capsule 三态切换、四大 Tab 与自由拖拽） |
| `CompactConfigMenu` | 输入栏旁的紧凑配置下拉（primary 配置项） |
| `AgentComposer` | 输入框、附件、选区标记 |
| `AgentMark` | Agent 徽标（布局/TitleBar 共用） |
| `AgentAuthDialog` | 认证方式选择（复用本机 Codex / Google 登录，对齐 VS Code / Zed） |
| `AgentProviderDialog` | 自定义模型供应商配置（base URL + API Key + 模型，Key 只存主进程） |
| `AgentHistoryMenu` | 历史线程切换（按 `selectedRuntimeId` 经 `selectThreadsForRuntime` 过滤 + 运行时名动态标题；`session-slice.setSelectedRuntimeId` 切 runtime 自动建/复用专属线程） |
| `AgentBunInstallBanner` | 缺 Bun 运行时提示与一键安装横幅 |
| `AgentAgyInstallBanner` | 缺 Antigravity CLI (agy) 运行时提示、复制命令与一键安装横幅 |
| `DiagramModal` | 大图全屏交互检视模态框（缩放、平移、Mermaid 源码查看、SVG 导出） |

## chat/ 消息列表渲染

| 文件 | 功能 |
|------|------|
| `AgentMessageList` | 消息列表容器（时间线分组、贴底滚动、孤案权限卡兜底；memo 隔离流式刷新） |
| `AgentActivityGroup` | 活动 grouping（同类消息聚合 + 计时） |
| `AgentChatItem` | 消息行通用骨架（列宽、可展开体、聊天打开态） |
| `AgentMessageBubble` | 用户/助手气泡（Markdown、tool 卡、提议块挂接） |
| `AgentScrollToBottomButton` | 「回到底部」浮动按钮 |

## tools/ 工具调用展示

| 文件 | 功能 |
|------|------|
| `AgentToolCallCard` | 工具调用卡（含权限子卡、图表卡、跨章实体卡、内容审计探针与导读建议挂接） |
| `DiagramViewerCard` | 交互式双模图表卡（时序步骤流 / 实体概览 / Mermaid 原生出图 / 正文穿透 / 钉入） |
| `CrossReferenceCard` | 跨章节实体概念流转轨迹卡（章节分布热力权重条 / 证据折叠 / 跨章定位） |
| `ContentAuditCard` | 深度内容审计探针卡（命中条目来源标识 / 原文取证高亮 / 一键正文穿透定位） |
| `ChapterSuggestionCard` | 智能导读与续读推荐卡（章节关联度分数 / 推荐理由 / 一键切章研读） |
| `AgentDiffPreview` | diff 预览 |
| `AgentPlanCard` | 计划条目卡 |
| `AgentBlockRenderer` | 兼容入口（tool 消息） |

## propose/ 批注提议

| 文件 | 功能 |
|------|------|
| `ProposeMarkChatBlock` | 聊天气泡内可折叠提议块（含批量勾选采用） |
| `ProposeMarkCard` | 单条划重点提议卡 |
| `ChapterMarkPlanCard` | 章级划重点建议（用户点选章后继续 Agent） |

## permission/ 权限审批

| 文件 | 功能 |
|------|------|
| `AgentPermissionCard` | 工具权限请求卡（聊天内联审批按钮） |

> 订阅接线已在 `hooks/agent/useAcpPermissionIngest` / `useMontreeSnapshotHost`（原 `AgentPermissionHost` / `AgentSnapshotHost` 假组件已删，App 根直接调 Hook）。

---

会话状态机：`src/hooks/agent/useAcpSession`；UI 状态：`acp-ui-store`。

协议/传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`；标记提议模型见 `@montree/annotations`（`mark-proposal` 单条·批量、`chapter-mark-plan` 章级建议）。
