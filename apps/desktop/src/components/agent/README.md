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
| `AgentComposer` | 社区 PromptInput 输入/附件预览，Electron 路径/图片/ACP payload 适配；IME 与键盘由社区接管 |
| `AgentMark` | Agent 徽标（布局/TitleBar 共用） |
| `AgentAuthDialog` | 认证方式选择（复用本机 Codex / Google 登录，对齐 VS Code / Zed） |
| `AgentProviderDialog` | 自定义模型供应商配置（base URL + API Key + 模型，Key 只存主进程） |
| `AgentHistoryMenu` | 历史线程切换（按 `selectedRuntimeId` 经 `selectThreadsForRuntime` 过滤 + 运行时名动态标题；`session-slice.setSelectedRuntimeId` 切 runtime 自动建/复用专属线程） |
| `AgentBunInstallBanner` | 缺 Bun 运行时提示与一键安装横幅 |
| `AgentAgyInstallBanner` | 缺 Antigravity CLI (agy) 运行时提示、复制命令与一键安装横幅 |
| `DiagramModal` | Radix Dialog 大图弹窗（焦点/关闭）；图表缩放、平移、复制、下载由 Streamdown 接管 |

## chat/ 消息列表渲染

| 文件 | 功能 |
|------|------|
| `AgentMessageList` | 消息列表容器（`lib/agent/chat-timeline` 回合分组、社区 Conversation 跟随、线程窗口/位置恢复、可见窗口内孤立审批兜底；memo 隔离流式刷新） |
| `AgentActivityGroup` | 工作记录折叠组（同一用户回合一条，运行中默认收起；整回合计数+取消/未知/未加载注记；详情为轻量工具行，按需展开单个调用；用户选择跨 chunk/落定保留） |
| `chat/AgentWorkLog.test.ts` | 工作记录/结果入口组件回归（默认收起、选择保持、单次渲染、失败摘要、审批外置） |
| `AgentResultEntry` | 富业务结果独立入口（紧凑过程行 + 独立业务卡，单次调用只渲染一处，`probe="result"`） |
| `AgentChatItem` | AI Elements Message 的产品布局/探针桥接（卡片与系统提示共用约束） |
| `AgentMessageBubble` | 用户/助手气泡（Markdown、tool 卡/结果入口、提议块挂接；助手正文无 AGENT 冗余头，流式由外圈状态表达） |

## tools/ 工具调用展示

| 文件 | 功能 |
|------|------|
| `AgentToolCallCard` | 通用工具 UI（社区 `ai-elements/Tool` 折叠外壳 + Montree 状态/中文标题映射；运行/成功/失败默认收起，保留用户展开选择；失败摘要行内可见、提议恢复操作在折叠外；审批经 `ToolApprovalSlot` 外挂且唯一；`detailsOnly` 让工作记录一次点击直接查看详情；`suppressBusinessResult`/`bare` 供结果入口复用过程行，业务卡不双挂） |
| `ToolBusinessResult` | 阅读业务结果渲染（图表/跨章互引/内容审计/章节建议/章节比较/HTML Artifact 卡 + 知识卡片沉淀/原文定位；`compactResults` 下图表默认紧凑预览） |
| `ChapterComparisonCard` / `.test.ts` | 章节比较卡（章节筛选、证据展开、原文定位；按结果 ID 隔离局部状态） |
| `HtmlArtifactCard` / `.test.ts` | HTML Artifact 卡与隔离预览（allow-scripts 沙箱、宿主 CSP/postMessage 校验、查看源码、宿主导出） |
| `DiagramViewerCard` | 交互式图表卡（结果入口默认紧凑：标题+短摘要+至多 3 步+完整入口；展开后为时序步骤流 / 实体概览 / Mermaid 原生出图 / 正文穿透 / 钉入；紧凑态隐藏 Tab，内部展开态随 key 稳定） |
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
| `AgentPermissionCard` | 工具权限请求卡（聊天内联审批按钮；同步领取当前请求实现跨卡幂等，旧请求/重复点击不再发送） |
| `ToolApprovalSlot` | 工具审批槽（命中当前 pending 才渲染；通用工具卡与批注提议分支统一经此挂载，调用方置于折叠容器外） |

> 订阅接线已在 `hooks/agent/useAcpPermissionIngest` / `useMontreeSnapshotHost`（原 `AgentPermissionHost` / `AgentSnapshotHost` 假组件已删，App 根直接调 Hook）。

---

会话状态机：`src/hooks/agent/useAcpSession`；UI 状态：`acp-ui-store`。

协议/传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`；标记提议模型见 `@montree/annotations`（`mark-proposal` 单条·批量、`chapter-mark-plan` 章级建议）。
