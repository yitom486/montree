# src/stores/acp

ACP 智能体交互与次世代伴读 HUD 专职状态管理。由原 1182 行巨石仓库 `acp-ui-store.ts` 拆解分流而成。

| 文件 | 职责说明 |
| :--- | :--- |
| `acp-types.ts` | 会话线程、权限审批卡与 HUD 模态通用数据类型定义与线程会话辅助 |
| `session-slice.ts` | 协议连接状态（status）、运行时切换、会话 ID、模型与配置项偏好（preferredConfig） |
| `chat-slice.ts` | 宿主线程业务元数据、工作区路由、回放清洗与快照提议；通用消息/回合意图经 `chat-session-authority` 仅在包内归约，宿主 messages 是包 feed 的兼容投影 |
| `chat-helpers.ts` | 线程草稿修剪、提议挂载与工具调用卡片解析纯逻辑辅助；线程↔运行时绑定防线（`ensureActiveThreadForRuntime` + `patchActiveThread` 错位纠偏） |
| `permission-slice.ts` | 工具调用权限审批拦截（pendingPermission）与审批记录同步 |
| `hud-slice.ts` | 伴读 HUD 面板开闭与输入框调度 |
| `reader-hud-store.ts` | 伴读 HUD 独立表现层（三态切换、自由拖拽坐标、四大 Tab、卡轨开关、全屏图表模态） |
| `acp-store.ts` | Slices 组装、包 feed 只读投影与业务元数据持久化（`montree-acp-metadata/v2`）；旧历史键保留，消息正文仅由包会话持久化 |
| `window-storage.ts` / `window-storage.test.ts` | 按 preload 窗口标识分区聊天历史；主窗口兼容旧历史，新窗口仅继承界面和运行时偏好 |
| `index.ts` | 模块统一导出入口 |

---

### 设计原则与架构边界
1. **Slices 模式物理隔离**：每个切片文件仅百余行，逻辑清晰内聚，彻底解决巨石代码维护痛点。
2. **纯 UI 隔离**：`reader-hud-store.ts` 专职处理界面拖拽、Tab 切换、抽屉模态等纯前端视觉状态，避免与底层 ACP JSON-RPC 消息流混杂。
3. **单权威兼容投影**：父级 `acp-ui-store.ts` 保持业务接口，消息数组来自包订阅；外部修改投影不会成为包 feed 写入源，产品恢复/提议清洗必须走显式受控更新入口。
