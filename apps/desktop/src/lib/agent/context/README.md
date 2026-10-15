# lib/agent/context

Montree → Agent 上下文：静态 Skill、turn-context、阅读器内容/选区/标记 registry、MCP 快照序列化。

首次会话提供完整静态说明；`build-prompt-prefix.ts` 每轮在工具概览中附上 `MONTREE_INTERACTIVE_GUIDANCE`，鼓励适合比较、引用探索、理解检查及流程讲解的问题主动使用模板和 SVG 图解。简短事实直接文字回答，实际工具可用且成功后才声称组件已生成。每 10 轮的完整渲染速览照常保留，所有提示仍由 bootstrap 标记在回放时剥离。

说明见 [../../README.md](../../README.md) 的 **agent/** 节（`agent/context/`）。

MCP 工具表与传输纯逻辑已独立至 `@yitom/acp-client`；快照/虚拟文件类型见 `@montree/contracts`（`packages/contracts/src/agent/`）。

`reader-visual-context.ts` 收集图片引用和阅读区范围（图片内容不自动注入）；`reader-content-registry.ts` 的正文读取附带简短图片提示。宿主新增 `montree_list_images` 与 `montree_capture_viewport`，截图返回 PNG 内容，保持链接与像素语义分离。契约见 `packages/contracts/src/agent/reader-visual-context.ts`。

增删或改名后，更新 `apps/desktop/src/lib/README.md`。

`reader-marks-registry.ts` 的章节导航返回 `Promise<boolean>`，仅在实际加载/定位完成时成功；等待期间 provider 被替换则拒绝旧结果。Foliate 目录与 ready 同步到导航 store，分片导航按宿主视口验位；未提供导航的格式明确引导手动打开，不广播伪定位成功。

`document-tool-registry.ts` 连接当前表格/PPT 内存模型和 MCP 读写，同时供文件操作读取 dirty 状态、撤销和保存。坐标选区契约见 `packages/contracts/src/agent/document-tools.ts`；空白单元格同样有效。`useDocumentReader` 将 HTML、JSON、LOG、DOCX、表格和 PPT 接入正文/搜索/目录工具。

PPT 的 `montree_ppt_edit_text` 使用读取结果中的段落/片段编号及 UTF-16 范围进行局部修改；替换文字必须核对 expectedText，整批核对 expectedCount 和 revision。读取结果的 context 分别返回可见页、导航页及选区页，不以滚动位置猜测选中目标。

高级 PPT 工具沿用同一内存模型与快照链路：`montree_ppt_read` 的 charts/design/animation 查询先返回能力、稳定 ID 与影响范围，再由 `montree_ppt_chart_edit`、`montree_ppt_design_edit`、`montree_ppt_animation_edit` 定点修改。图表缓存与内嵌 XLSX 原子同步，共享部件须核对 expectedSlides，动画全量列表须核对 expectedEffectIds；复杂类型保留并拒绝覆盖。组合内部沿用原元素删改工具与局部坐标，继承装饰通过 sourcePart 对应设计工具修改。静态 Skill 与工具概览同步这些限制。

`montree_present` 只做展示声明（章节比较/HTML 小应用版本化信封），经 `present` 快照资源由 `present-result-builder.ts` 校验组装（章节必须对应目录、摘录逐章验证、资源上限双端一致），不写文件、不改文档。契约与稳定 ID 见 `packages/contracts/src/agent/present-result.ts`。

`present-presets.ts` 提供 `kind=preset` 的固定模板：`chapter-comparison` 复用比较卡（2–6 章），`citation-guide` 和 `reading-quiz` 组装既有白名单组件（1–6 章）。引用逐条验证原文并定位；测验选择通过原会话提交给助手点评，无本地自动判分。工具仍只有 `montree_present`，模型填数据即可，无需生成 JSX 或 UI 树。

`present-diagram.ts` 把 `preset=diagram` 的节点/连线参数生成流程图、时序图、架构图、思维导图、泳道图、时间线、鱼骨图、循环图或 ER 图 HTML+SVG，经 `HtmlArtifactCard` 的内联隔离帧展示；支持缩放、紧凑节点详情、键盘与宿主主题同步（浅色/深色/纸色）；隔离帧绘制后确认，参与页面统一 View Transition，等待上限 160ms，不重建 iframe。思维导图只接收连通树；泳道图要求角色泳道与阶段，同一泳道同一阶段不能重叠节点。时间线按输入事件顺序等距排列并可加 when；鱼骨图限制一个结果、2–4 类原因及每类最多两个子原因；循环图限制 3–8 个节点并按输入顺序闭合。ER 实体有 1–8 个字段与 PK/FK/UK 标记，关系两端显式基数，可引用已有字段；首版不支持自关联或同对实体多关系。`montree_diagram_guide` 按需提供适配规范（`packages/contracts/src/agent/diagram-design.ts`），不在用户 Agent 环境安装 skill。参考 cathrynlavery/diagram-design 的图表设计规范，模板为 Montree 独立实现，不含完整上游 skill/脚本/全部图型；许可见 `apps/desktop/resources/LICENSE.diagram-design.txt`。

网页目录与本地章节共用 `montree_read(scope=toc/chapter)`：provider 使用文档 ID 并显式提供目录，toc/章节结果保留 href；网页跨页在后台读取，章节失败携带 URL/原因。比较卡固定目录快照同时检查标题、层级和 href，防止同标题换链接后混用原文。
