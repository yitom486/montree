import { ChevronDown, FileCode2, Image as ImageIcon, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  frontmatterField,
  parseFrontmatterEntries,
  readFrontmatter,
  type FrontmatterEntry,
} from '@/lib/editor/markdown-frontmatter'
import { cn } from '@/lib/utils'

interface FrontmatterPreviewProps {
  source: string
  className?: string
}

function displayValue(key: string, value: string): string {
  if (!value) return '—'
  if (key === 'cover' || key === 'cover_media_id' || key === 'icon' || key === 'category_id') {
    return value.length > 40 ? `${value.slice(0, 37)}…` : value
  }
  return value.length > 160 ? `${value.slice(0, 157)}…` : value
}

/**
 * 所见即所得里的 frontmatter 卡片：默认只展开展示标题/摘要与关键属性，
 * 原始 YAML 不再直接铺在正文里；点击「编辑源码」或属性区可回到文本编辑。
 */
export function FrontmatterPreview({ source, className }: FrontmatterPreviewProps) {
  const [open, setOpen] = useState(false)
  const frontmatter = useMemo(() => readFrontmatter(source), [source])
  const entries = useMemo(
    () => frontmatter?.entries ?? parseFrontmatterEntries(source.split(/\r?\n/)),
    [frontmatter, source],
  )
  if (!frontmatter) return null

  const title = frontmatterField(entries, 'title')
  const excerpt =
    frontmatterField(entries, 'excerpt') ??
    frontmatterField(entries, 'description') ??
    frontmatterField(entries, 'summary')
  const cover = frontmatterField(entries, 'cover')
  const visibleEntries = open ? entries : entries.slice(0, 4)
  const hiddenCount = entries.length - visibleEntries.length

  return (
    <section
      className={cn('cm-live-frontmatter', className)}
      aria-label="文档属性"
      title="文档属性（YAML frontmatter）"
    >
      <header className="cm-live-frontmatter-header">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="cm-live-frontmatter-title truncate">{title || '文档属性'}</h2>
            <span className="cm-live-frontmatter-count">{entries.length} 项</span>
          </div>
          {excerpt ? <p className="cm-live-frontmatter-excerpt">{excerpt}</p> : null}
        </div>
        {cover ? (
          <span className="cm-live-frontmatter-cover" title={cover}>
            <ImageIcon className="size-3.5" aria-hidden />
            <span className="truncate">{cover}</span>
          </span>
        ) : null}
      </header>

      <div className="cm-live-frontmatter-properties">
        {visibleEntries.map((entry) => (
          <PropertyRow key={`${entry.key}-${entry.value}`} entry={entry} />
        ))}
      </div>

      {hiddenCount > 0 || open ? (
        <button
          type="button"
          className="cm-live-frontmatter-toggle"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
          aria-expanded={open}
        >
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          {open ? '收起属性' : `展开全部 ${entries.length} 项属性`}
        </button>
      ) : null}
    </section>
  )
}

function PropertyRow({ entry }: { entry: FrontmatterEntry }) {
  return (
    <div className="cm-live-frontmatter-row">
      <span className="cm-live-frontmatter-key">
        {entry.key === 'title' || entry.key === 'excerpt' || entry.key === 'cover' ? (
          <Tag className="size-3" aria-hidden />
        ) : null}
        {entry.key}
      </span>
      <span className="cm-live-frontmatter-value" title={entry.value}>
        {displayValue(entry.key, entry.value)}
      </span>
    </div>
  )
}
