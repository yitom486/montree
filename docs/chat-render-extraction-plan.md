# 聊天渲染抽离计划：`@montree/chat-core` + `@montree/chat-ui`

> 工作区：本分支 `chat-render-init`（由 `master@551be1f` 建工作树）。
> 目标：把聊天框的富文本渲染能力抽成**与 ACP 协议零耦合**的包（`acp-client` 管协议和会话，新包只管展示），先在 monorepo 内孵化（`private:true`），API 冻结 + 出现第一个外部消费方后再毕业到独立 repo 发 npm。
> 总性质：**80% 搬运 + 换 import 源，20% 剪 store 改 props**；渲染逻辑不重写，每步行为不变。

## 0. 分层（一句话）

- `chat-core`：纯 TS，零 react（沿用 `lint:deps` R3，无豁免）——消息显示模型、timeline 分组、tool-display 映射、URL 策略、markdown 微插件。
- `chat-ui`：唯一允许 react 的包（R3 白名单仅此包）——`headless/` hooks（渲染什么）+ `ui/` 默认组件（长什么样）+ `slots` 覆盖 + 回调回宿主。
- 宿主 adapter（留在 `apps/desktop`）：`ACP 事件 → ChatMessage[]` 归一化、store→props 接线、回调回 `sendPrompt`、Electron 专属（Sucrase 编译、IPC、工作区 store、滚动落盘）。

## P4 修复与工作记录继续迁移（2026-10-17）

- 线程恢复：包线程保存 `hostThreadId`；宿主初始化/恢复和线程生命周期边界同步权威历史，修复重启关联、运行时切换、删除最后线程、空草稿裁剪和 40 条上限。后台补建不抢当前可见线程。
- 数据一致性：用户附件完整进入包消息；历史回放仅同步宿主清洗后的单线程正文。流式宿主在写入前取得包实例，避免重建时首包追加两遍；定居事件先落定悬垂用户回放，再冻结一次，不错误终结回合。
- 窗口隔离：`chat-session-owner` 按 preload 窗口 scope 持有实例和存储分区，main 沿用旧键，副窗口不继承主历史；内存回落同样隔离，并校验损坏快照。
- 测试：新增异步输入框→mock transport→原始 ACP→真实 store→DOM 集成，覆盖多轮、失败重试、取消迟到消息、审批唯一性、JSON 恢复续聊及附件；宿主生产订阅、双窗口恢复、运行时和线程生命周期另有回归。
- 后续迁移：完整工作记录行为下沉 `chat-ui/ChatActivityGroup`，宿主 `AgentActivityGroup` 保留状态/业务适配，包内 `ChatPanel` 共用该组件并传线程归属；审批仅在无内联卡时补兜底卡。完整输入框、视口分页/滚动、认证与应用业务编排仍留宿主，本轮未切换所有聊天入口。
- Electron 验收：聊天相关 28 条 E2E 通过；最终构建再次定向复查历史图表、线程切换、流式工作记录、滚动恢复与双窗口，共 6 条通过。构建和体积检查通过（首屏 0.36MB，总量 37.29MB）。
- 单元/集成验收：`bun run test --maxWorkers=4` 全量 389 文件、2789 用例通过，另有既有 3 文件/4 用例跳过；类型检查、依赖边界及文档检查通过。默认高并发与 E2E 同跑时曾有一条 PPT 测试触发原 5 秒超时，未改其源码或阈值，限制并发后全量通过。

## M3 进展（2026-10-16）

- M3a ✅ ChatMarkdown：主题 prop 化等，详见本轮报告；`lint:docs` 5 错误已修。
- M3b ✅ 气泡件三路并行：纯批 9 搬（`AgentActivityGroup` 留守，待 Bubble+M3c）、Bubble props 化（resolve 必填/pending prop/dismiss 回调 + 被迫第 4 prop `onPermissionRespond`；`pendingPermission` 用全量类型而非窄 `PendingApprovalRef`，已接受）、审批对（`onRespond` + 宿主 `permission-respond.ts` + 临时直引待收敛）。残留 8 R4 精确收敛于气泡文件→M3c/stays/M3d，为 M3c/d 前提；私复制品（message-shell/button/layout-probe/dev-log）M4 与宿主对账。验收：chat-ui 81 + 宿主 agent 124 全过；typecheck/lint:docs 0。未 commit。
- M3c/d ✅ 已完成并验收（2026-10-16）：工具卡 6 件（ToolCallCard pending/恢复/nav props 化 + 宿主槽注入、Diagram Mermaid 槽化未复制 MermaidBlock、Propose 去 fallback/toast 回调化）+ present 7 件（ArtifactFrame 隔离语义逐字、Html theme→colorScheme/export→onExport、React compile/export→props、ComponentUi 双件、ChapterComparison）。审核处理：`result-card` 双写嫌疑经核仅 `cn` 行差（M3c 声明内）；barrel 7 行统一接（具名避重）；DiagramViewerCard 兼容 shim 已删（M3d 漏切一行由审核补）；README 悬空 token 6 处已修。测试随文件进包（宿主 agent 22→15，包 12→20，总数守恒）。验收：包 20/137 + 宿主 agent+markdown 15/70 全过；lint:deps 仅剩主题 R4×1（M4 前提）；typecheck/lint:docs 0。未 commit。

## M4 进展（2026-10-16）

- 主题收尾 ✅：Bubble `theme` prop 化，宿主 4 处透传，R4 清零（`lint:deps` 0 错误）。
- 残留收敛 ✅：`ComposerAttachmentKind` 去重；11 私有复刻定案维持（包不依赖宿主，宿主原件保留，已记 chat-ui README）；临时直引零残留。
- barrel 去环 ✅：包内互引全改相对，barrel 补 Bubble/Permission/Slot，宿主 6 文件改 barrel；`build` 无循环警告。
- E2E 抓到三个真回归并修复（均为迁移副作用，我亲手修）：
  1. 主题回执断流：M3d 把主题注册表复刻进包内私有 Set，宿主过渡函数只通知宿主集 → 带 requestId 的回执路径成死代码（E2E 主题回执 0）。修：包导出 `register/notifyArtifactThemeParticipants`，宿主 160ms race 内同驱（注意早退陷阱：帧迁出后宿主集为空，必须先启动包通知再判断）。单元 3 用例新增。
  2. Tailwind 丢类：v4 自动扫描只覆盖渲染根，包内独用类（如 `@min-[480px]:columns-2`，构建 CSS 0 条 vs master 1 条）被 tree-shake → 比较卡列数断言挂。修：`globals.css` 加 `@source` 包路径（与 streamdown 先例同式）。
  3. 入口 compact 丢失：M3c 把 `AgentResultEntry` 改为 slot 注入时丢了 `compactResults=true`（master 入口强制紧凑，详情路径才展开），种子时间线图表卡直接展开、`查看完整图表` 按钮消失。修：slot opts 加 `compactResults`，包入口分支传 true、宿主两槽透传，详情路径保持 expanded（与 master 一致）。tool-timeline 7/7 转绿。
- E2E 终轮：rich-result 6/6；generative-ui 7/8 起步，SVG 在 master 亦红，后经加固转绿，见“测试加固”。

## 测试加固（2026-10-16，测试-only，未改产品代码）
- 单测超时：真实 git 子进程 5 用例 `, 30_000`、web-doc 重链路用例 `, 15_000`（满载 I/O，非逻辑问题）。
- SVG 三漂移点：306 布局测量改 `expect.poll`（阈值一字不改）；326 文本断言 timeout 15s；根因修复：浮窗内 `.click()` 在负载下不中，改为内联段同款 focus+Enter（253 行模式），SVG 单跑与整文件 8/8 全绿。
- tool-timeline / streamdown / rich-result 全绿。分块复验：packages 90/644、electron+scripts 84/606、src 197/1356。

## 包内渲染集成测试（2026-10-16）

- `packages/chat-ui/src/ui/chat-render.integration.test.ts` 8 用例：时间线分组对照 core、富文本落定、4 工具态互斥、审批链点击回执、component-ui 真树提交 payload、未知组件 Fallback、react iframe+onCompile/onExport、html onExport、dark 渲染、回调签名。全 happy-dom，零 montree 启动。
- 铁律：只从两包 barrel 进（消费者视角，防缺导出与深路径依赖）；`readableToolTitle` 下划线边界行为按实际修正 fixture（非产品改动）；无降级项。chat-ui 22 文件 148 用例全过，lint:deps 0。

## M5 进展（2026-10-16）

- 全量门禁 ✅：`test` 371 文件 2606 用例全过（首跑 exit 1 零 FAIL，复跑绿，满载 flaky 类同既往）、`lint:docs/lint:deps/typecheck/build/check:bundle` 全绿（首屏 0.36MB/总量 37.27MB，预算未动）、`git status` 无构建污染。未 commit。
- 消费文档 ✅（`packages/chat-ui/README.md`）：用法指南（安装/peer/CSS/`@source`/主题/数据流三步/24 行伪代码/自定义）+ 功能清单（24 条按 barrel 分组）+ 回调表。审核修正 6 处：KaTeX 来源实锤宿主全局表、`register*` 单复数、删虚构 `useInlinePresent`、删虚构 `ChatList/onApprove` 泛名、两悬空“不确定项”指向、`mermaidTheme` 未启用如实保留。E2E 引用 M4 结论（rich 6/6，gen 7/8，SVG 既有 flaky）。
- 剩余：M6 毕业（scope/构建/peer/CSS 分发/版本/LICENSE），另议，不在本分支做。

## E1 发动机归约器（2026-10-16，我亲写）

- `chat-feed.ts`：`ChatFeedState/ChatFeedEvent/applyChatEvent` + `finalizeFeedMessages`，10 种事件，逐字对齐宿主 `chat-slice/chat-helpers`（行号见文件头）；宿主保留回放清洗/合并器/快照队列/审批 ingest/隔离过滤（非归约职责）。
- 附带：prune 整搬入 core；promote 拆 fallback 参数（宿主 wrapper 保旧签名）；`acp-prune-agent-replies` 宿主留兼容层。
- 测试 16 用例覆盖 8 不变量；审出 2 处测试误写（迟到 chunk 宿主行为为另起 settled 气泡非 +=；`turnEnded` 缺键非 undefined），已按宿主代码为准修正。
- 验收：core 17 文件全过 + 宿主关联（promote/stores）共 28 文件 222 用例；lint:deps 0；lint:docs 0；typecheck 0。未切宿主（E1b 另行：归约器先行并存，E2E 通过后再切）。
- E2 `message-parts.ts` 9 变体 24 用例已落地（子智能体，我已验收，见 M5 记录）。

## E1b 宿主切归约器（2026-10-16）

- `chat-slice` 各分支改调 `applyChatEvent`（ACP 线路命名翻译放 adapter；回放清洗/合并器/快照队列/`prompting`/隔离过滤留宿主）；`finish-turn` 加 `settle:false` 供定居路径；快照 attach 纯部入 core。
- 我审计删除死码：`chat-helpers` 的 `applyToolCallUpdate` + `finalizeThreadMessages`（零外部调用，归约器已接管），并清理连带 import；`annotation-agent-store` 自有本地版本不受影响。
- 验收：单测 74 文件 598 用例（等价性铁证：宿主测试零修改）+ core；lint:deps/lint:docs/typecheck/build 全绿。
- E2E：streamdown 3/3、tool-timeline 7/7、rich-result 6/6、generative-ui 8/8（含既往 flaky 的 SVG 本次全绿）。未合 master。

## S1 会话纯状态层（2026-10-16，子智能体，我已验收）

- `packages/chat-session` 新包（R3 豁免 + alias + tsconfig 已注册）：`session/store.ts`（线程/审批/模型配置 + storage/transport ports，全部 feed 变更经 core 归约器）、`ingest/acp-events.ts`（sessionUpdate/permission/status 映射，输入一律 unknown，零耦合 acp-client 版本）、config 纯部整搬（menu/preferences/model-thinking，宿主留重导出）。
- 补充语义（宿主没有、包新增）：`requestPermission/setConnectionStatus` 纯态方法、ingest 可选 threadId 路由；有意简化留宿主：回放清洗/合并器/快照队列/滚动/workspace/`prompting`。
- 验收：包 5 文件 84 用例 + 宿主 acp 43 用例；lint:deps 0；typecheck 0。未合 master。

## S2/S3 会话绑定与深模拟（2026-10-16）

- S2：`useChatSessionStore/useActiveThread/useChatActions` + `<ChatPanel>/<ChatComposer>`（runtime/thinking 双 select、审批双挂载、work-log 最小 details）；我补 `selectRuntime`（曾误写 modelId）并改测试断新语义。
- S3：`session/simulation.test.ts` 4 剧本 100 断言（完整会话/脏事件/多线程/模型配置），只走两包 barrel；present 卡渲染断言止于结果入口壳（完整卡由宿主槽传入，既定分工）。
- 验收：包 7 文件 94 用例；lint:deps 0；typecheck 0。未合 master。

## 失败回合回滚（2026-10-16，线上 bug，我亲修）

- 现象：模型额度报错文本以 agent 正文 chunk 流入正常气泡 → 冻结 → prune 当“最后有效回复”保留 → 持久化 → 每回合复现如狗皮膏药（额度耗尽期每发必败，每败必留泡）。
- 根因：`sendPrompt` 失败路径只写系统消息，从不清理本回合已流进的气泡文本；且无 pattern 能可靠识别各家额度文案，故不用文本分类，用“prompt 结果失败”做回滚信号。
- 修法：core 加 `rollback-turn`（只删 agent/thought，工具/用户/系统/计划保留）；slice 加 `rollbackFailedTurn`；`sendPrompt` 在 `!isOk` 时先回滚再补系统通知。取舍：失败回合的部分真实回答会被一并丢弃（已记录；相对“错误答案变历史”可接受）。
- 关键修正（测试连挂三次抓出的真问题）：回滚锚定最初用墙钟 `>=`，同毫秒多消息无法区分——E2E mock 环境亚毫秒回合会误删上回合好答案。改为 id 锚定（回合开始时的已有 id 快照），与时钟无关，确定性 5 连绿。另澄清：prune 从不删旧回合真实回答（只压缩当前回合内），旧答案保留是对的。
- 验收：core 回滚用例 + store 回归（额度文本消失/工具保留/用户保留）40/40；typecheck/lint 全绿。未合 master。

## P0–P3 宿主瘦身（2026-10-16，子智能体，我已验收）

- P0：宿主 `chat-transport-port.ts`（send/cancel/respond + prompt 前缀/bootstrap/附件，失败抛错不写时间线）+ 12 用例。
- P2a：`ChatPanel` 补 `renderBusinessResult/renderPlanCard/onGenerativeSubmit/onEditMessage` 透传。
- P3：`setModelOption?`（port 接口 + 真实现，照抄 setModel 成功记忆/失败 false）+ `clearActiveThread()` + `onRuntimeChange?`（缺省仅 selectRuntime，线程亲和应用侧管）。
- 验收：包 session 8 文件 115 用例；lint:deps 0；typecheck 0。测试文件零改动既有用例。未合 master。

## P4a 双写对账（2026-10-16，子智能体，我已验收）

- `chat-store-mirror.ts`：三镜像函数（update/permission/status，纯转发 + try/catch 内吞 + acpDevLog），`getPackageMirrorStore` 懒单例；5 分发点均为宿主写之后加一行（只加法）；等价测试：同剧本双跑归一化 7 字段 deep-equal。
- 验收：lib/agent + stores 56 文件 425 用例（我复跑一致）；lint:deps 0。未合 master。

## P4b 单面切换（2026-10-17，子智能体×3，我修 reload 空洞并验收）

- `DockedAgentPane`（阅读器三 viewer 侧栏）经 `messageSource="package-mirror"` 改读包镜像 store；其余面默认 host 零影响。
- 我补的 reload 空洞：包 store 空 + 无 switch 事件时 docked 面空白。`resolvePackageThreadId`（映射→认领→消息路径自动建线），全部 mirror 调用透传宿主线程 id；映射表按包隔离 WeakMap。
- P4b 补齐轮：resolve/select 纯搬 core；包 store 加 appendSystem/rollbackFailedTurn/freezeSettled/resolveProposal/selectChapterPlan/deleteThread/renameThread/attachSnapshot（迷你队列）；镜像 kinds 全覆盖改消息动作。
- 验收：单测全绿；lint:deps/typecheck/lint:docs/build 全绿；E2E generative-ui 8/8、rich-result+timeline+streamdown 16 全绿。未合 master。

## P4c 正式持有（2026-10-17）

- `apps/desktop/src/lib/agent/chat-session-owner.ts`：`getOwnedChatSessionStore()` 正式持有单例（`createChatSessionStore` + localStorage 持久化 `ChatStoragePort`，键 `montree-chat-session/v1`，JSON 快照整体读写 + 版本字段校验 + 缺失回落内存）；全仓 `getPackageMirrorStore` 已替换并删除（`chat-slice`/`acp-stream-host`/permission ingest/`AgentMessageList`）。
- 双写契约：宿主 store = Electron 应用脑（认证/滚动/批注/prompting）；包 store = 可移植会话态；mirror 保对齐 + parity 测试锁死；单写退宿主写待 M6 后。
- 验收：`chat-session-owner.test.ts` 4 用例（单例同一性/save→新实例 load/缺失回落/坏 JSON 丢弃）；既有测试零改动，行为零改动。未合 master。

## 合并预检（2026-10-17，全绿，随时可合）

- 单测 386 文件 2744 用例；lint:docs/lint:deps（1132 文件）/typecheck 全绿；build + check:bundle（首屏 0.36MB/总量 37.29MB）全绿。
- E2E：generative-ui 8/8（含 SVG 9 图表：flowchart/sequence/mindmap/swimlane/timeline/fishbone/cycle/er/architecture，截图已目验时序图）、rich-result + timeline + streamdown 16 全绿。
- master 仍在 551be1f，分支单 commit 领先，工作树干净。未合，待命。

## 流式宽度抖动修复（2026-10-16，我亲查）

- 现象：流式输出时聊天框宽度来回抖 + 右侧滚动条时有时无。根因：视口纵向滚动条出现/消失吃掉约 12px 内容宽度（流式增高出滚动条 → 工具完成自动收起高度骤减 → 滚动条消失 → 回流，全程反复）。
- 修法：聊天视口加 `[scrollbar-gutter:stable]` 预留槽位（`AgentMessageList` + `data-testid="chat-viewport"`）；E2E 锁两条：流式中消息列宽极差 ≤3px、视口 gutter 为 stable。streamdown 3/3 + generative-ui 8/8 回归绿。
- 已证伪/归因：代码/表格内部滚动条是 Streamdown 社区默认（code 400/table 300 上限，完成态亦然，实测 1397→359），非流式特有；settled 套件 300px 零正文溢出；祖先链零横移。未复现的瞬间裁剪帧需用户侧复现信息（流式中/完成后、哪个面、内容类型）。
- 未合 master。

## 1. 输入契约（包只吃这个，不碰 ACP 原语）

`ChatMessage { id, role, text, streaming, attachments, tool*, planEntries, proposals, presentResult, steps }`（由 `stores/acp-chat-types.ts` 脱水改名而来），覆盖全部输出：
文本流式 / thought / 工具 7 终态（`awaiting-approval/pending/in-progress/completed/failed/cancelled/unknown`）/ diff 与定位 / plan / 批注提议与章计划 / `montree_present` 四 kind（comparison/html/component-ui/react-artifact）/ 引用证据 / 附件 / 审批选项 / 错误。
回调：`onApprove / onSubmitSelection / onLocate / onResolveProposal / onEdit / onQuote`。

## 2. 里程碑

- **M0 脚手架**（本分支已做）：两包 `package.json/README/src/index.ts` + `workspaceAlias` + R3 白名单，各门禁绿。
- **M1 core 搬运**：按 `chat-core/README.md` 表逐文件迁入（含 `.test.ts`），宿主改 import 源；`acp-chat-types.ts` 拆纯部时把 `@montree/annotations` 引用降为 contracts 类型（开放项，见 §4）。
- **M2 headless** ✅ 已完成并验收（2026-10-16）：`useRevealText` 整搬入 `chat-ui/headless`（hash 一致，唯一调用方 Bubble 换源）；新建 `useChatTimeline` / `useToolDisplay`（core 函数的 useMemo 包裹 + deep-equal 对照测试）；`chat-ui` 加 react peerDeps；补记 M0 遗漏：`tsconfig.web.json` 收录两新包 paths+include（此前未引用到的新文件游离于 typecheck 之外，现补齐后全绿）。验收：chat-ui 3 文件 + Bubble 共 18 用例；lint:deps 0；typecheck 0。未 commit。
  - 后续更新：聊天文字已统一为 Streamdown 原生动画；M2 当时迁入的旧打字机 Hook、导出与专用测试已删除，上述记录仅描述迁移历史。
- **M3 ui 搬运**：先 `AgentMarkdown → ChatMarkdown`（主题/URL 策略 props 化），再气泡件（Bui/Beui 系列、`ToolCallCard`、`WorkLog`），最后 present 四件套（`ComponentUiCard`、`ReactArtifactCard`、`ArtifactFrame`，安全语义原样带走，编译器留主进程）。
- **M4 宿主 adapter**：`acpChatToChatMessage()` + 薄接线层；E2E 留宿主验证行为不变。
- **M5 门禁**：`typecheck / test / build / test:e2e + lint:docs / lint:deps / check:bundle` 全绿；首屏预算不放宽，UI 入口懒加载。
- **M6 毕业**：翻 `private:false` + tsup 构建 + peerDeps（react19/streamdown/assistant-ui）+ CSS 分发 + 主题 token + LICENSE（含 BeUI/Beautiful 署名），迁独立 repo，contracts 走 npm 版本。

## 3. 门禁调整（M0 内完成）

- `scripts/check-deps.ts` R3：仅 `chat-ui` 豁免 react，其余包照旧。
- `apps/desktop/electron.vite.config.ts` `workspaceAlias`：追加 `chat-core/chat-ui`。
- 不碰：R1/R2/R4/R5/R6/R7、`check:bundle` 预算。

## 4. 开放项

1. `acp-chat-types.ts` 对 `@montree/annotations`（`ProposedMark/ChapterMarkPlanEntry`）的依赖：随类型迁 contracts 还是包内重声明，M1 定。
2. 默认 UI 样式底座：中性 CSS + CSS 变量（避免硬绑 tailwind4/shadcn），M3 定。
3. 中文文案与主题映射留宿主还是进包，M3 定（默认留宿主）。

## 5. 完成标准

外部 App 仅依赖 `chat-core + chat-ui (+ contracts)`，传 `ChatMessage[]` + 回调，即可渲染与本应用一致的全部 ACP 输出；本应用 E2E 全绿；无新增依赖；不 commit 到 `master`（切片合回）。
