// 自 `apps/desktop/src/components/agent/tools/ArtifactZoomSurface.tsx` 整搬（M3d present 批，pure）：
// `Button` 改引包内 `./button`，`Dialog*` 改引包内 `./dialog`；余逐字。
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2 } from 'lucide-react'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './dialog'

const ZoomContext = createContext<{ close: () => void } | null>(null)
export const useArtifactZoom = () => useContext(ZoomContext)
type MovableElement = HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void }

/** 单实例预览：portal 容器稳定，Chromium 原子移动保留 iframe/组件内部状态。 */
export function ArtifactZoomSurface({ title, children }: { title: string; children: ReactNode }) {
  const [container] = useState(() => document.createElement('div'))
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(0)
  const inline = useRef<HTMLDivElement | null>(null)
  const supported = typeof (HTMLElement.prototype as MovableElement).moveBefore === 'function'
  function move(target: HTMLElement, enlarged: boolean) {
    if (container.parentElement !== target) {
      if (container.isConnected) (target as MovableElement).moveBefore!(container, null)
      else target.appendChild(container)
    }
    container.className = enlarged ? 'h-full w-full min-w-0 [&_iframe]:!h-full' : 'w-full min-w-0'
  }
  function changeOpen(next: boolean) {
    if (next) setHeight(container.getBoundingClientRect().height)
    // 必须在 Dialog 移除节点前还原容器，否则 iframe 会被卸载并丢失状态。
    else if (inline.current) move(inline.current, false)
    setOpen(next)
  }
  return (
    <ZoomContext.Provider value={{ close: () => changeOpen(false) }}>
      <Dialog open={open} onOpenChange={changeOpen}>
        <div className="mb-1 flex justify-end">
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={!supported} aria-label={`放大查看：${title}`}>
              <Maximize2 className="size-3.5" />放大查看
            </Button>
          </DialogTrigger>
        </div>
        <div ref={(node) => { inline.current = node; if (node && !open) move(node, false) }} style={open ? { minHeight: height } : undefined} />
        {createPortal(children, container)}
        <DialogContent className="flex h-[85dvh] w-[94vw] max-w-[94vw] flex-col overflow-hidden p-4 sm:max-w-6xl motion-reduce:animate-none">
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>放大查看，可继续交互；关闭后返回聊天。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto" ref={(node) => { if (node && open) move(node, true) }} />
        </DialogContent>
      </Dialog>
    </ZoomContext.Provider>
  )
}
