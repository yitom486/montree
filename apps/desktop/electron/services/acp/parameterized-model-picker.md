# 参数化模型选择（parameterizedModelPicker）

cursor-agent 按 `initialize` 的 `clientCapabilities._meta.parameterizedModelPicker` 决定模型下发形状。
本篇只讲该标记的两态、Cursor 原生五维度对照、缺席语义与渲染端三层设计。握手实现本身在主进程，不在此展开。

## 1. cursor 两种模式

- **不声明（旧默认）**：只给爆炸开的 variant 串，例如
  `grok-4.7[context=256k,reasoning_effort=high,fast=true]` /
  `claude-sonnet-4[reasoning_effort=low]` / `default[]` / `mini[thinking=false]`。
  模型值把思考档与 `fast` 开关编码进尾缀，没有独立选项。
- **声明后（当前）**：给朴素模型值 + 独立选项，例如模型 `grok-4.7`，
  另有 boolean 型 `fast` 与 select 型 `reasoning-effort`（`low`/`medium`/`high`）、
  select 型 `context`（`256K`/`500K`）、select 型 Agent 模式。
  输入栏走标准 `set_config_option` 下发 advertised 值。
- Cursor 原生是五个独立维度（用户实测 + 原生截图）：Model（Grok 4.7…）、
  Context（256K/500K）、Effort（Low/Medium/High/Extra High）、
  Fast 开关（"Significantly faster but consumes more usage"，默认开）、Agent 模式。

## 2. 标记位：哪次握手、哪个字段

- 时机：`agent.initialize`（ACP `initialize`），每次拉起子进程建连时发送一次。
- 字段：`clientCapabilities._meta.parameterizedModelPicker = true`。
- 位置：`apps/desktop/electron/services/acp/acp-connection.ts` 的 `initialize` 组包处，
  与 `fs.readTextFile/writeTextFile`、`terminal` 等 `clientCapabilities` 并列。
- 对齐对象：新版 Zed（`1.8.2-pre` 起），来源 `zed-industries/zed#57571`。
- `_meta` 是 ACP 标准扩展点，未知字段应被其余 Agent 忽略（codex 等仅多收一个字段）。

## 3. 为什么改写被拒（Invalid params）

- 未声明时的爆炸串只能原样回传。拼一个未 listed 的新 id
  （如把 `fast=true` 手搓成 `fast=false`）并乐观 `set_config_option`，
  cursor-agent 实测直接拒收（`Invalid params`），用户侧表现为连接即报错。
- 握手全局声明该标记后，“拼未 listed 模型 id 并乐观发送”的野路子已无必要，
  也是之前连接即报错的根因。现一律只发 Agent advertised 的 listed 原值。

## 4. 对照表：Cursor 原生控件 → ACP 参数化 option 形状 → 我方 UI 控件

| Cursor 原生控件 | ACP 参数化 option 形状 | 我方 UI 控件 |
|---|---|---|
| Agent 模式 | select 型，`category==='mode'` 或 id/name 含 `mode`（`collab` 除外），如 `session-mode` | 输入栏第 1 位下拉（`rankPrimary=0`，`CompactConfigMenu`） |
| Model（Grok 4.7…） | select 型，`category==='model'` 或 id 含独立 `model` 词，如 `model=grok-4.7`（朴素值） | 输入栏第 2 位下拉（`rankPrimary=1`，`CompactConfigMenu`） |
| Effort（Low/Medium/High/Extra High） | select 型独立项，id 含 `thought`/`reason`/`effort` 或 `category==='thought_level'`，如 `reasoning-effort=low/high` | 输入栏第 3 位下拉（`rankPrimary=2`，`CompactConfigMenu`；用户已证实思考下拉点亮） |
| Context（256K/500K） | select 型独立项，`category==='context'` 或 id/name 含 `context`/`ctx`（大小写不敏感），如 `context=256k/500k` | 输入栏第 4 位下拉（`rankPrimary=3`，`CompactConfigMenu`，与前三位同一定序 `0/1/2/3`） |
| Fast 开关（默认开，"Significantly faster but consumes more usage"） | 双形：boolean 型含 `fast` 字样（`findFastToggle`，category 不限）→ 输入栏可见开关；select 型含 `fast` 字样（如 `fast=false/true`）→ 进「更多设置」菜单 | 输入栏 Fast 开关（boolean 形直接渲染；尾缀 `fast=true\|false` 形走 `selectSuffixFastState` 且互斥优先，见 §5） |

display 顺序固定为 mode0/model1/thought2/context3（`splitConfigOptions` 按 `byRank` 定序，
同 rank 第二个起进 secondary，secondary 逻辑不变）。

## 5. 缺席语义：以 cursor 下发为准，不硬编

- 某维度缺席 = 该模型没下发该 option，不是 bug。
  例如 grok 无 fast 版时输入栏不出 Fast 开关、某模型无 context 档时不出第 4 位下拉；
  界面零变化（现有空安全延续：`fastToggle=null`、primary 缺位不占位）。
- Fast 仍缺席的两种可能（用户实测思考下拉已点亮、fast 仍缺席）：
  该模型没下发 fast 项，或下发形状未被 `fast` 字样覆盖；一律以 cursor 下发为准，
  不为缺席维度硬编假选项、 DAM 不拼未 listed 值（§3）。
- 单测以本次 fixture 断言为准：五件套（mode+朴素 model+独立 thinking+独立 fast+独立 context）
  全点亮；缺 fast 时其余四项正常且无报错（见 `acp-config-menu.test.ts`）。

## 6. boolean fast 开关与尾缀版的关系

- boolean 版：`findFastToggle` 命中任一 `fast` 字样 boolean 项，
  `selectFastDefaultOffTarget` 做默认关一次 + `preferredConfigByRuntime` 偏好记忆，
  参数化 Agent 走这条。
- 尾缀版：模型 `currentValue` 含 `fast=true|false` 时
  `selectSuffixFastState` 生效，两者互斥、尾缀优先
  （`suffixFast ? null : booleanFastToggle`）。
- 尾缀版默认关一次已删除：只保留 boolean 版默认关一次；
  尾缀版切换只走同 base listed 门槛（`findListedVariantId`），无目标即禁用。

## 7. 我们现在的三层设计（渲染 + 纯逻辑，回落不变）

1. **参数化独立选项（首选）**：`splitConfigOptions` / `rankPrimary` / `findFastToggle`
   （`apps/desktop/src/lib/agent/acp-config-menu.ts`）。rank0 模式 + rank1 模型 +
   rank2 思考下拉 + rank3 上下文下拉 + boolean `fast` 开关，下发 advertised 值，参数化 Agent 用。
2. **同 base listed variant 选择（兼容旧爆炸串）**：`findListedVariantId` +
   `listedModelOptionValues` + `selectModelThinkingControl` / `selectSuffixFastState`
   （`apps/desktop/src/lib/agent/acp-model-thinking.ts`）。只在同 base、
   除目标 key 外其余 param 全等时返回 listed 原值；无目标则禁用、不发起
   注定失败的切换。思考下拉与尾缀版 `fast` 开关的 listed 门槛判定走这里。
3. **只读徽标兜底**：`extractModelSuffixThinking` / `selectReadonlyModelThinking`。
   无 rank2 且模型尾缀自带档位时仅展示（跟随模型切换，不可单独改）；
   variants 模式 Agent 仍需要该展示。

面板 wiring 见 `apps/desktop/src/components/agent/AgentPanel.tsx`
（primary 区 `primary.map(CompactConfigMenu)` 复用同一紧凑下拉，第 4 位 context 零特殊分支；
缺席维度不渲染，空安全延续），
连接后偏好套用见 `apps/desktop/src/hooks/agent/useAcpSession.ts`。
通用失败只弹一个 toast（`切换配置失败`），不做乐观 pending/回滚。

## 8. 参考

- `zed-industries/zed#57571`：`https://github.com/zed-industries/zed/pull/57571`
- 握手注释见 `acp-connection.ts`（`_meta.parameterizedModelPicker=true` 处）。
- 解析兼容：`packages/acp/src/session/config-options.ts`
  （布尔/数字选项值转 string，boolean `currentValue` 原样保留）。

## 9. 双命名空间：方括号 variants vs 横杠 canonical（受控尝试）

- **两套命名**：ACP `configOptions` 下发的模型值是方括号 variants
  （如 `grok-4.7[context=256k,reasoning_effort=high,fast=true]`），而
  `agent models`（`--list-models` 同源）列出的是横杠 canonical id
  （如 `grok-4.7-high` / `grok-4.7-high-fast`）。用户实测：variants 列表只有
  `fast=true` 版、无 `fast=false` 版，改写方括号串被 `Invalid params` 拒收；
  但 `agent models` 证明 `grok-4.7` 有非 fast 版，只是名字是横杠式。
  另 `--help` 证实启动 `--model` 接受方括号覆盖。
- **目录来源**：主进程 `@yitom/acp-client` 的 `getCursorCatalogIds`
  复用已解析的 agent 命令（`resolveCursorSpawnCommand`，无则 null）以
  `--list-models` 经 `spawnSync` 拉取（超时 6s，逐行首 token 为 id，
  `auto` 保留原样，空输出/超时/非零退出一律 null），进程级内存缓存一次
  （不断言跨版本新鲜度）。`openSessionAfterAuth` 在 cursor 成功建会话后附带拉取，
  失败吞掉记 dev 日志、不阻断连接，经 `AcpConnectResult.modelCatalog`
  （`packages/contracts/src/types/acp.ts` 可选字段）带回渲染；
  渲染端 `session-slice` 以 `modelCatalogByRuntime` 内存态（不持久化）按运行时存放，
  连接成功写入、disconnect/切换清空（沿用 `setSession`/`setStatus` 现有清位语义）。
  全程无新 IPC 方法；渲染禁 spawn 红线不变（目录只在主进程拉）。
- **受控尝试语义**：方括号↔横杠无可靠机械映射（thinking 中缀时有时无），禁止硬编码推导。
  渲染 `acp-model-thinking.ts` 的 `pickDashCounterpart` 只做精确匹配：
  候选须以当前 base 开头（含 `base-` 边界）；effort 词
  （low/medium/high/xhigh/max/minimal/none/extra high 类归一化比对）与当前一致
  （思考切换则等于目标）；fast 维度按目标取反（含 `-fast` 后缀 vs 无）；
  多命中取字典序首个；任一步暧昧即 null（宁缺勿试）。
- **面板 wiring**：`AgentPanel` 思考/fast 切换先走 listed 门槛
  （`findListedVariantId`），未命中时再查 dash 对应（需目录在 store，否则跳过）；
  命中走同一 `setModel` 链路，Agent 仍可能拒收→已有单 toast + 保持旧值兜底。
  连接时 fast 默认关一次同样允许 dash 目标（`useAcpSession`，静默失败不打扰）。
  boolean/独立版优先级不变，dash 仅为最后候补；无目录时本节全部跳过，
  行为与 §5—§7 现状一字不改。
