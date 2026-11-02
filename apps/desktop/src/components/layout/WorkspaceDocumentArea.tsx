import { createContext, useContext, type ReactNode, type Ref } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const WorkspaceDocumentOutlineContext = createContext<{ content: ReactNode; available: boolean; onToggle: () => void } | null>(null)

/** 文档工具栏下方的正文与页内目录；宽度只在主工作区内分配。 */
interface WorkspaceDocumentAreaProps {
  children: ReactNode
  mainRef?: Ref<HTMLElement>
  readerViewport?: boolean
  footer?: ReactNode
}

export function WorkspaceDocumentArea({ children, mainRef, readerViewport, footer }: WorkspaceDocumentAreaProps) {
  const outline = useContext(WorkspaceDocumentOutlineContext)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-editor" data-testid="workspace-document-area">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main ref={mainRef} data-reader-viewport={readerViewport || undefined} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-editor">
          {children}
        </main>
        {footer}
      </div>
      {outline?.available && (
        <aside
          className="min-h-0 shrink-0 px-3 py-4"
          style={{ width: outline.content ? 'clamp(176px, 22%, 240px)' : '48px', maxWidth: '34%' }}
          aria-label="文档目录面板"
        >
          {outline.content || (
            <Button variant="ghost" size="icon-sm" className="size-6 text-muted-foreground" onClick={outline.onToggle} aria-label="展开文档目录" title="展开文档目录">
              <PanelRightOpen className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </aside>
      )}
    </div>
  )
}
