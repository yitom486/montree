import { cn } from './cn'

/**
 * 富结果卡统一外壳（redesign 审计结论）：六张业务卡同一视觉语言。
 *
 * - 单层中性描边 + 卡片底，无 backdrop-blur（不透明卡片上无用且费性能），
 *   无 transition-all（只在可交互子元素上过渡）；
 * - 头部浅底单线；图标统一 primary 淡底（图标本身各卡不同，表意保留）；
 * - 摘要统一 11px（此前 10px 难读）；标题截断，详情不靠缩小压高度；
 * - 功能性微文案（如“只读取证”）保留，纯装饰标签（水墨图谱、原始工具名）
 *   删除；实体/查询等关键 tag 走 primary，避免第二、第三强调色。
 * - ChapterComparisonCard 的 `@container` 保留在各自文件（容器查询所需）。
 * - 入场挂载播一次 `animate-result-card-in`（淡入 + 上滑 + 轻 scale）：
 *   更新 props 不重挂载，流式中不重播；reduce-motion 全局关停。
 */
export const RESULT_CARD_SHELL =
  'overflow-hidden rounded-xl border border-border/60 bg-card text-card-foreground shadow-xs animate-result-card-in'

export const RESULT_CARD_HEADER =
  'border-b border-border/60 bg-muted/30 px-3 py-2'

export const RESULT_CARD_ICON =
  'flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary'

export const RESULT_CARD_SUMMARY = 'truncate text-[11px] text-muted-foreground'

export function resultCardClassName(className?: string): string {
  return cn(RESULT_CARD_SHELL, className)
}
