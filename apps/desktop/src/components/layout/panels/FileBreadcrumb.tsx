// Visual reference: beui.dev/components/motion/breadcrumb, MIT © 2026 Saurabh Chauhan.
// Host navigation and shadcn menu remain authoritative. See ../../agent/LICENSE.beui.
import type { ReactNode } from 'react'
import { ChevronRight, Ellipsis, Folder } from 'lucide-react'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { cn } from '@/lib/utils'

interface FileBreadcrumbProps {
  filePath?: string
  workspaceRoot?: string
  isDirty: boolean
  welcome?: boolean
  trailing?: ReactNode
}

export function getBreadcrumbSegments(filePath: string, workspaceRoot?: string) {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  const file = normalize(filePath)
  const root = workspaceRoot ? normalize(workspaceRoot) : undefined
  const windows = /^[a-z]:|^\/\//i.test(file)
  const compare = (path: string) => windows ? path.toLowerCase() : path
  const inside = root && compare(file).startsWith(compare(root === '/' ? '/' : `${root}/`))
  const segments = Array.from(filePath.matchAll(/[^/\\]+/g), (match) => ({
    label: match[0], path: filePath.slice(0, match.index + match[0].length), navigable: Boolean(inside),
  }))
  if (!inside || !root || !workspaceRoot) return segments
  return [
    { label: root.split('/').pop() || '/', path: workspaceRoot, navigable: true },
    ...segments.filter((segment) => normalize(segment.path).length > root.length),
  ]
}

const PATH_BUTTON = 'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'

function PathSeparator() {
  return <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/50" />
}

export function FileBreadcrumb({ filePath, workspaceRoot, isDirty, welcome = false, trailing }: FileBreadcrumbProps) {
  const revealDirectory = useEditorUiStore((state) => state.revealDirectory)
  const segments = filePath ? getBreadcrumbSegments(filePath, workspaceRoot) : []
  const ancestors = segments.slice(0, -1)
  const current = segments.at(-1)
  const root = ancestors.length > 1 ? ancestors[0] : undefined
  const parent = ancestors.at(-1)
  const renderDirectory = (segment: NonNullable<typeof parent>) => segment.navigable ? (
    <button type="button" className={PATH_BUTTON} title={segment.path} onClick={() => revealDirectory(segment.path)}>
      <Folder aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{segment.label}</span>
    </button>
  ) : <span title={segment.path} className="truncate px-1.5 text-xs text-muted-foreground">{segment.label}</span>

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur-sm">
      <Breadcrumb aria-label="文件路径" className="@container min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1">
          {root ? <BreadcrumbItem className="max-w-28 shrink-0 @max-[28rem]:hidden">{renderDirectory(root)}<PathSeparator /></BreadcrumbItem> : null}
          {ancestors.length > 0 ? (
            <BreadcrumbItem className={cn('shrink-0', ancestors.length === 1 && '@min-[20rem]:hidden', ancestors.length === 2 && '@min-[28rem]:hidden')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="显示上级路径" className={cn(PATH_BUTTON, 'px-1')}><Ellipsis aria-hidden="true" className="size-4" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-[min(24rem,calc(100vw-2rem))] motion-reduce:animate-none">
                  {ancestors.map((segment) => (
                    <DropdownMenuItem key={segment.path} disabled={!segment.navigable} onSelect={() => revealDirectory(segment.path)} title={segment.path}>
                      <Folder aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{segment.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <PathSeparator />
            </BreadcrumbItem>
          ) : null}
          {parent ? <BreadcrumbItem className="max-w-36 shrink-0 @max-[20rem]:hidden">{renderDirectory(parent)}<PathSeparator /></BreadcrumbItem> : null}
          <BreadcrumbItem className="min-w-0 flex-1">
            <BreadcrumbPage key={filePath ?? 'untitled'} title={filePath} className="flex min-w-0 items-center gap-1 font-medium motion-safe:animate-[file-breadcrumb-in_160ms_ease-out]">
              <span className="truncate">{current?.label ?? (welcome ? '欢迎' : '未命名文档')}</span>
              {isDirty ? <span aria-label="未保存" className="shrink-0 text-primary">•</span> : null}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="shrink-0">{trailing}</div>
    </div>
  )
}
