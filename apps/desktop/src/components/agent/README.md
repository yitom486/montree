# src/components/agent

ACP Agent 面板（壳自研；消息渲染可复用 Markdown/Mermaid 块）。已按渲染链分子目录（2026-09 重构）。

Beautiful UI 展示语法来源：`slev12397/beautiful-ui`，main tree `44a274e598395ab61e7c96c26fda2758780253b7`（2026-10-14 获取）。完整许可见 `LICENSE.beautiful-ui`（MIT © 2026 Shane Levine）。Loading/Thinking/Approval 与工作记录 chip 行按真实 ACP 数据适配，无演示步骤。

BeUI 来源为 `https://beui.dev/r/` 下 message-bubble、streaming-response、agent-activity、citations、agent-progress 的公开 registry（2026-10-14 获取），MIT © 2026 Saurabh Chauhan，完整许可见 `LICENSE.beui`，随包分发。保留内容槽/状态/动作与展示语法，按 Montree 宽度、主题与实际数据适配；Motion 改 CSS，无新依赖。复制保留原 Markdown，不生成占位重试、反馈或来源；正文继续由 Streamdown 渲染，滚动继续由 assistant-ui 管理。原始 registry 与摘要留本地计划记录。

## 根目录：面板与接线

| 文件 | 功能 |
|------|------|
| `AgentPanel` | 右侧 Agent 主面板（壳 + 接线；配置项分类纯逻辑已出库 `lib/agent/acp-config-menu`，模型尾缀思考档只读徽标见 `lib/agent/acp-model-thinking`，fast 类 boolean 在输入栏给可见开关（`findFastToggle` 单列，不进 secondary），其余 boolean 仍在 secondary；运行时切换器全量读 `BUILTIN_ACP_RUNTIMES`，下游 8 项落地后零改动展示，非 codex 走中性认证提示；生成式 UI 提交经 `handleGenerativeSubmit` 做线程归属校验后沿 `sendPrompt` 回到同一会话） |
| `DockedAgentPane` | 阅读器内停靠态面板壳（左侧拉伸分隔线，宽持久化，三端 viewer 共用） |
| `AgentHeaderOverflowMenu` | 聊天头部 ⋯ 溢出菜单（新对话/清空/模式切换） |
| `FloatingAIHud` | 悬浮 AI 伴读浮窗与微型药丸胶囊（支持 docked / floating / capsule 三态切换、四大 Tab 与自由拖拽） |
| `CompactConfigMenu` | 输入栏旁的紧凑配置下拉（primary 配置项） |
| `AgentComposer` | BeUI Prompt Input 布局适配：可换行参数与独立 32px 发送/停止；附件、ACP payload、IME/键盘沿用社区内核；输入框右键编辑 |
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
| `AgentMessageList` | 消息列表容器（`lib/agent/chat-timeline` 回合分组、社区 Conversation 跟随、线程窗口/位置恢复、可见窗口内孤立审批兜底；memo 隔离流式刷新；生成式提交经 `onGenerativeSubmit` 透传面板 `sendPrompt` 链路） |
| `AgentContextMenu` | 聊天/输入框右键：选区快照、复制原文、引用草稿、剪切/粘贴文本/全选与回底；异步编辑校验线程与当前草稿 |
| `AgentActivityGroup` | 工作记录折叠组（同一用户回合一条；思考在前，运行中只展示最新普通工具的固定行；完成自动收起一次，手动展开保留完整历史；摘要含真实进度与取消/未知/未加载注记，详情按需展开） |
| `chat/AgentWorkLog.test.ts` | 工作记录/结果入口组件回归（最新工具稳定行、完成收起与手动回看、单次渲染、失败摘要、审批外置） |
| `AgentResultEntry` | 富业务结果独立入口（紧凑过程行 + 独立业务卡，单次调用只渲染一处，`probe="result"`；component-ui 经 `threadId`/`prompting`/`onGenerativeSubmit` 透传选择提交链） |
| `tools/result-card.ts` | 六张业务卡统一外壳（单层中性描边/浅底头/primary 图标/11px 摘要；去装饰标签与 teal 独走；跨章水墨热力与朱砂印属卡内数据可视化保留；比较卡 `@container` 留各自文件） |
| `AgentChatItem` | AI Elements Message 的产品布局/探针桥接（卡片与系统提示共用约束；`bare` 供自带气泡的子组件使用，避免双层外观） |
| `BuiThinking` | Thinking 展开视觉（Beautiful UI ThinkingState 语法重写：sparkle+shimmer/fade 标题、chevron、grid-rows 展开、时间线 rail；状态与展开全受控，无定时无演示数据；`body` 槽承载思考 markdown，原渲染管线与安全语义不变） |
| `BuiMessage` | BeUI Message Bubble 适配（用户右气泡 / 助手轻表面 / 系统居中；CSS 一次入场、动作槽 hover/focus；流式光环沿用 beam，稳定挂载） |
| `BeuiStreamingResponse` | BeUI 输出外壳适配（真实 streaming/complete、aria-busy、落定复制动作；内容槽仍走 AgentMarkdown，不实现额外流式解析器） |
| `AgentLoadingState` / `.test.ts` | 当前回合真实等待/审批/思考/工具状态及计时，视觉转交 BeuiAgentProgress；无 reasoning 不声称思考，计时结束/卸载清理 |
| `BeuiAgentProgress` | BeUI 受控耗时、像素加载、ThinkingShimmer；复用宿主计时与 CSS，减少动画停动效，无虚构轮播阶段 |
| `BeuiAgentActivity` | BeUI Activity 时间线表面与工具行；复用现有聚合、折叠、审批槽与详情，保留失败/取消/未知状态 |
| `BeuiCitations` / `.test.ts` | 折叠结构化来源；章节比较仅列已验证摘录，内容审计列明确检索证据；文档定位走宿主原守卫，网页限 http/https，无远程 favicon；未扩普通回复协议 |
| `AgentMessageBubble` | 用户/助手气泡（用户与系统分支经 `BuiMessage` 布局，附件/时间/复制/编辑原样保留；思考分支经 `BuiThinking` 头+展开壳、正文仍走 AgentMarkdown 管线；Markdown、tool 卡/结果入口、提议块挂接；助手正文无 AGENT 冗余头，流式由描边光环 + tip 呼吸光标表达；正文经打字机揭示（小步高频提交） + deferred 让路滚动/输入，新块挂载仅淡入，避免位移动效与跟滚叠加；消息动作行 hover/focus 才显：用户复制+编辑回填续改，助手复制原文；tool 富结果经 `threadId`/`prompting`/`onGenerativeSubmit` 透传生成式提交） |

## tools/ 工具调用展示

| 文件 | 功能 |
|------|------|
| `AgentToolCallCard` | 通用工具 UI（社区 `ai-elements/Tool` 折叠外壳 + Montree 状态/中文标题映射；运行/成功/失败默认收起，保留用户展开选择；失败摘要行内可见、提议恢复操作在折叠外；审批经 `ToolApprovalSlot` 外挂且唯一；`detailsOnly` 让工作记录一次点击直接查看详情；`suppressBusinessResult`/`bare` 供结果入口复用过程行，业务卡不双挂；工作记录行目标 chip pill 借 Beautiful UI ToolChips 语法） |
| `ToolBusinessResult` | 阅读业务结果渲染（图表/跨章互引/内容审计/章节建议/章节比较/HTML Artifact/生成式 UI 卡 + 知识卡片沉淀/原文定位；`compactResults` 下图表默认紧凑预览；component-ui 经 `generative/` 懒加载卡渲染，选择提交与定位回调透传） |
| `generative/ComponentUiCard` + `.lazy` + `.test.ts` | 生成式 UI 卡（官方 `GenerativeUIRender` + 白名单 Card/Row/Column/Text/Select/Button/Evidence，shadcn/主题复用；本地选择态按结果 ID 隔离；提交/定位只经宿主回调；未知组件 Fallback + 卡内错误边界；懒加载约 7KB，首屏不进包。详见 `generative/README.md`） |
| `ChapterComparisonCard` / `.test.ts` | 章节比较卡（章节筛选、证据展开、原文定位；按结果 ID 隔离局部状态） |
| `tools/ArtifactZoomSurface` | 居中放大预览；同一 portal 容器以原子移动保留 iframe/组件状态，关闭返回原位置，Esc 与焦点恢复；不创建第二个 iframe |
| `tools/ArtifactFrame` / `.test.ts` | 隔离 iframe 共享宿主（内联 React 与 HTML 对话框共用 srcDoc 组装、来源+挂载 ID+2KiB 白名单消息、高度钳制/限频/微差忽略；sandbox 仅 allow-scripts） |
| `HtmlArtifactCard` / `.test.ts` | HTML Artifact 卡与隔离预览；内置 SVG 图解直接内联、同步主题且不重建帧；普通 HTML 仍以对话框经 `ArtifactFrame` 挂载，行为不变：allow-scripts 沙箱、宿主 CSP/postMessage 校验、查看源码、宿主导出） |
| `generative/ReactArtifactCard` / `.test.ts` | React 内联卡（同卡构建→编译→加载→就绪/失败真实状态；成功直接挂内联 iframe，ready 仅认 React commit 确认；失败重试/重跑；源码视图为模型源码，导出离线 HTML；支持居中放大，仍为同一 iframe 单实例。详见 `generative/README.md`） |
| `DiagramViewerCard` | 交互式图表卡（结果入口默认紧凑：标题+短摘要+至多 3 步+完整入口；展开后为时序步骤流 / 实体概览 / Mermaid 原生出图 / 正文穿透 / 钉入；紧凑态隐藏 Tab，内部展开态随 key 稳定） |
| `CrossReferenceCard` | 跨章节实体概念流转轨迹卡（章节分布热力权重条 / 证据折叠 / 跨章定位） |
| `ContentAuditCard` | 深度内容审计探针卡（命中条目来源标识 / 原文取证高亮 / 一键正文穿透定位） |
| `ChapterSuggestionCard` | 智能导读与续读推荐卡（章节关联度分数 / 推荐理由 / 一键切章研读） |
| `AgentDiffPreview` | diff 预览 |
| `AgentPlanCard` | 计划条目卡 |

## propose/ 批注提议

| 文件 | 功能 |
|------|------|
| `ProposeMarkChatBlock` | 聊天气泡内可折叠提议块（含批量勾选采用） |
| `ProposeMarkCard` | 单条划重点提议卡 |
| `ChapterMarkPlanCard` | 章级划重点建议（用户点选章后继续 Agent） |

## permission/ 权限审批

| 文件 | 功能 |
|------|------|
| `AgentPermissionCard` | 工具权限请求卡（渲染 Beautiful UI ApprovalCard 视觉：圆角卡+选项行+取消；选项/标题来自真实 pending，同步领取实现跨卡幂等，旧请求/重复点击不再发送；busy 选中行转圈并全禁用） |
| `BuiApprovalCard` | 权限卡纯视觉（单 pending 请求：标题+选项按钮+取消；无问答状态机、无输入框、无 Skip/Continue；跨卡幂等由调用方保证） |
| `ToolApprovalSlot` | 工具审批槽（命中当前 pending 才渲染；通用工具卡与批注提议分支统一经此挂载，调用方置于折叠容器外） |

> 订阅接线已在 `hooks/agent/useAcpPermissionIngest` / `useMontreeSnapshotHost`（原 `AgentPermissionHost` / `AgentSnapshotHost` 假组件已删，App 根直接调 Hook）。

---

会话状态机：`src/hooks/agent/useAcpSession`；UI 状态：`acp-ui-store`。

协议/传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`；标记提议模型见 `@montree/annotations`（`mark-proposal` 单条·批量、`chapter-mark-plan` 章级建议）。

React artifact 经 `montree_present(kind=react-artifact)` 的真实工具结果独立懒加载：单文件 JSX/TSX 主进程离线编译，复用 HTML artifact 的 allow-scripts/CSP iframe，历史只保存源码。原文正文仍只走单 Streamdown。

R3 文本请求协议见 `packages/contracts/src/agent/react-artifact-actions.ts`：仅文本提议、1536字节上限；业务发送仍需 iframe 外用户确认，沿原 ACP 归属/忙碌/防重复链路。React 内联卡提供继续分析和请求修复，HTML artifact 未开放请求桥。
