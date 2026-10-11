import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DiagramViewerCard, type DiagramPayload } from './tools/DiagramViewerCard'

export interface DiagramModalProps {
  isOpen: boolean
  onClose: () => void
  diagram: DiagramPayload | null
  onHighlightAnchor?: (excerpt: string) => void
  onPinToDoc?: (diagram: DiagramPayload) => void
}

/** Radix owns focus, Escape, portal and dismissal; Streamdown owns graph interaction. */
export function DiagramModal({ isOpen, onClose, diagram, onHighlightAnchor, onPinToDoc }: DiagramModalProps) {
  if (!diagram) return null
  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="z-[100] max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{diagram.title || '交互图表'}</DialogTitle>
          <DialogDescription>{diagram.diagramType} · {diagram.diagramId}</DialogDescription>
        </DialogHeader>
        <DiagramViewerCard payload={diagram} onHighlightAnchor={onHighlightAnchor} onPinToDoc={onPinToDoc} />
      </DialogContent>
    </Dialog>
  )
}
