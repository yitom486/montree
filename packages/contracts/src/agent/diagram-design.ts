/** Design references: cathrynlavery/diagram-design (MIT, Cathryn Lavery). Montree parameter templates are independently implemented. */
export const DIAGRAM_TYPES = ['flowchart', 'sequence', 'architecture', 'mindmap', 'swimlane', 'timeline', 'fishbone', 'cycle', 'er'] as const
export type DiagramType = typeof DIAGRAM_TYPES[number]

/** Markdown document capabilities are separate from chat-only presentation actions. */
export const MARKDOWN_COMPONENT_GUIDE = `Montree Markdown 文件支持数据组件，不需要 MDX，也不执行任意 JSX/HTML 脚本。
使用语言名 montree-diagram 或 montree-ui 的 fenced code block，内容为 JSON，最多 64KiB，必须 schemaVersion:1 与 title。
montree-diagram: {schemaVersion:1,title,diagramType,nodes,edges,lanes?}。diagramType 支持 ${DIAGRAM_TYPES.join('/')}，先调用 montree_diagram_guide 获取对应布局及边界。不要传 html/source/css/坐标。
示例：{"schemaVersion":1,"title":"阅读流程","diagramType":"flowchart","nodes":[{"id":"read","label":"阅读"},{"id":"note","label":"整理"}],"edges":[{"from":"read","to":"note"}]}。
montree-ui: {schemaVersion:1,title,ui:{root}}，使用既有 Card/Row/Column/Text/Select/Button 白名单。Select.props={id,label,options:[{value,label}],multi?,defaultValue?}；Button.props={label,action:"submit-selection"}。文档内提交只显示本地选择汇总，不连接 ACP、不自动问 AI、不写文件；状态重新打开后重置。不支持 Evidence、locate、任意函数、外部依赖或 react-artifact；定位请用普通 Markdown 链接。
示例：{"schemaVersion":1,"title":"阅读选择","ui":{"root":{"component":"Column","children":[{"component":"Select","props":{"id":"focus","label":"关注方向","options":[{"value":"idea","label":"观点"},{"value":"example","label":"例子"}]}},{"component":"Button","props":{"label":"汇总选择","action":"submit-selection"}}]}}}。
需要跨阅读器静态版本时，用已有的普通 Markdown 图片 ![说明](./assets/diagram.svg)，其后空一行写 HTML 注释，首行 <!-- montree-diagram 或 <!-- montree-ui，下一行开始 JSON，独占一行 --> 结束；Montree 原位替换图片，其它支持图片及 HTML 注释的阅读器保留静态图片。相对 SVG 需实际存在并与文档一起分享，不得编造已保存的图片；当前工具不自动写图片，用户可从文档图解导出静态 SVG。没有图片时，可保留普通文字说明及隐藏参数。自定义 fenced blocks 在其它阅读器通常显示为源码；不是通用 Markdown 标准。
修改当前打开文档必须先 montree_text_read 获取最新 revision，再 montree_text_edit 按真实范围原子编辑，按需保存/撤销；不要用直接文件写入覆盖未保存正文。聊天里的 montree_present 只展示，不会把内容插入文件。`

export function diagramDesignGuide(type: unknown): string {
  if (!(DIAGRAM_TYPES as readonly unknown[]).includes(type)) throw new Error(`diagramType 须为 ${DIAGRAM_TYPES.join('、')}`)
  const rules = {
    er: '用于实体与数据关系。每个 node 必须有 fields: 1–8 项 {name,type,key?,details?}，name 唯一且最多 24 字，type 最多 12 字，key 可为 PK/FK/PK,FK/UK，details 最多 256 字。可用 layer(0–5) 指定左右层级；不传 kind/reply。每条 edge 必须指定 fromCardinality/toCardinality，值为 1、0..1、1..*、0..*，分别描述 from/to 实体这一端的数量；SVG 在两端直接标记，不使用箭头表示基数。可选 fromField/toField 必须同时提供并引用对应实体已有字段；只表达字段关联，不自动建立数据库约束。实体最多 12 个，关系最多 20 条；首版不支持自关联及同一对实体多条关系，复杂模型请拆图。基数、主外键必须来自已读资料或明确标注的设计建议，不要编造原文事实。',
    timeline: '用于事件与理论演变。nodes 按先后顺序提供，可加 when（最多 20 字的时间说明）；不传 layer/kind。edges 必须恰好按 nodes 顺序连接相邻事件，不能跳跃或回退。采用等距事件轴，不表示实际时间间隔；没有依据的日期不要编造。',
    fishbone: '用于原因分析。edges 从原因指向结果：唯一最终结果节点；2–4 个一级原因直接连结果，每个一级原因可带最多两个子原因；原因写在节点，不传连线 label。所有节点须连通，禁止循环、多结果与多重归属；不传 layer/kind/reply。这是解释性因果分类，不代表已证实因果，推测须在 details 注明。',
    cycle: '用于反馈与循环机制，3–8 个节点。nodes 按循环顺序排列，edges 必须依次连接相邻节点，最后一个回到第一个；不传 layer/kind/reply。每条边可用短 label 解释关系；不支持额外分支或自循环，复杂反馈拆图表达。',
    flowchart: '用于决策与分支流程。自上向下；start/end 用圆角端点，process 用矩形，decision 用菱形。每个决策出口必须命名，最多三个出口。用 layer 表达阶段，同层分支并排。',
    sequence: '用于请求响应。nodes 是从左到右排列的参与者；edges 按时间顺序排列。每条消息必须有 label，reply=true 表示虚线返回消息；允许自调用。首批不支持 alt/loop 组合片段，复杂协议请拆图或用自定义 HTML。',
    architecture: '用于组件与数据流。用 layer 表达从左到右的层级，同层组件纵向排列。连线先于节点绘制，使用直角转折。首批不支持嵌套信任边界，不要用未支持的分组参数伪造它。',
    mindmap: '用于整理主题与知识层级。edges 从父主题指向子主题，须构成一棵连通树：唯一根节点，每个非根节点恰好一个父节点，禁止循环或重复连线。不传 layer/kind/lane/reply；软件按树深度向右展开，兄弟主题按 nodes 顺序排列。',
    swimlane: '用于多角色协作流程。额外传 lanes: 2–4 项 {id,label}（id 英文标识，label 最多 20 字），每个 node 必须指定 lane（已有泳道 id）及 layer（0–5 阶段）。泳道按 lanes 顺序自上而下，阶段从左到右；同一泳道同一阶段只能一个节点。支持 start/end/process/decision 与命名决策出口，不支持泳道内并行分支；需要时拆成不同阶段或多张图。',
  }
  return `${rules[type as DiagramType]}\n调用 montree_present(kind="preset", preset="diagram", diagramType, title, nodes, edges)。nodes: 2–12 项（时序图最多 6 位参与者） {id,label,kind?,layer?,lane?,when?,fields?,details?}；edges: 1–20 项 {from,to,label?,reply?,fromCardinality?,toCardinality?,fromField?,toField?}。id 用英文标识；layer 为 0–5 整数；文字可中文。节点标签最多 40 字，决策标签最多 20 字；连线标签最多 14 个中文字符或 28 个英文字符。模型仅提交参数，软件负责 SVG 布局与缩放/节点详情交互，不提交坐标、源码或资源链接。超过规模请拆图；不得删掉重要关系来假装完整。\n设计参考 https://github.com/cathrynlavery/diagram-design；此工具提供 Montree 适配规范，并非完整上游 skill。`
}
