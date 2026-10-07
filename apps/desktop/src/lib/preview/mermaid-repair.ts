/**
 * Mermaid 源码智能语法修复与规范化器。
 * 针对 AI 或用户笔记中常出现的：
 * 1. 声明与正文挤在单行（如 `flowchart TD A["..."]`）
 * 2. 多个连线语句无换行连排（如 `A-->B1 C-->D`）
 * 3. 缺少头部声明（如直接 `A --> B`）
 * 4. 缺少分号或被外层多余反引号包裹
 */

const HEADER_REGEX =
  /^(\s*(?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|gitGraph|quadrantChart|xychart-beta|timeline|zenuml|sankey-beta)/i

export function repairMermaidSource(raw: string): string {
  if (!raw || !raw.trim()) return ''

  let code = raw.trim()

  // 1. 剔除外层误带的代码块反引号
  if (code.startsWith('```')) {
    code = code
      .replace(/^```(?:mermaid|[a-z0-9_-]*)\s*/i, '')
      .replace(/```\s*$/, '')
      .trim()
  }

  // 2. 如果完全缺少图表类型头部，但包含流程图连线，自动补齐 `flowchart TD`
  if (!HEADER_REGEX.test(code) && (code.includes('-->') || code.includes('---|') || code.includes('==>'))) {
    code = `flowchart TD\n  ${code}`
  }

  // 3. 头部与后续第一个语句在同一行时，强制拆行
  code = code.replace(
    /^(\s*(?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|gitGraph|quadrantChart|xychart-beta|timeline|zenuml|sankey-beta)\s+([^\n]+)/i,
    '$1\n  $2',
  )

  // 3.5 智能自愈被意外截断或插入换行的箭头连线（如 `--\n>` => `-->`, `==\n>` => `==>`, `-.-\n>` => `-.->`）
  code = code.replace(/(--|==|-\.-)\s*\n+\s*>/g, '$1>')
  code = code.replace(/(--|==)\s*>\s*/g, '$1> ')

  // 4. 将引号外部的分号转为换行（Mermaid 允许分号分隔语句；避免破坏双引号字符串内的内容）
  code = code.replace(/;(?=(?:(?:[^"]*"){2})*[^"]*$)\s*/g, '\n  ')

  // 5. 拆分连续连接的单行节点语句：
  // 匹配带括号/引号结束的节点紧跟下一个连线起点，例如：
  // `B1["..."] A --> C` => `B1["..."]\n  A --> C`
  code = code.replace(
    /(\]|\)|\}|>)\s+([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*(-->|---|==>|-.->|--\s*.*?-->)\s*/g,
    '$1\n  $2 $3 ',
  )

  // 匹配无括号修饰的普通标识符紧跟下一个连线，例如：
  // `--> B A --> C` => `--> B\n  A --> C`
  code = code.replace(
    /((?:-->|---|==>|-.->)\s*[a-zA-Z0-9_-]+)\s+([a-zA-Z0-9_-]+)\s*(-->|---|==>|-.->)\s*/g,
    '$1\n  $2 $3 ',
  )

  // 6. 时序图多语句单行拆分：`Bob: Hello Alice->>Bob: Hi` => `Bob: Hello\n  Alice->>Bob: Hi`
  if (/^sequenceDiagram/i.test(code)) {
    code = code.replace(
      /(:\s*[^\n]+?)\s+([a-zA-Z0-9_-]+)\s*(->>|-->>|->|-->)\s*([a-zA-Z0-9_-]+)/g,
      '$1\n  $2$3$4',
    )
  }

  return code.trim()
}
