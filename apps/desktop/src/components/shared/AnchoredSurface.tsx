// BeUI Morph Popover visual reference (MIT © 2026 Saurabh Chauhan).
// See ../agent/LICENSE.beui. Radix owns placement, dismissal and focus.
import { useMemo, useRef, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { cn } from '@/lib/utils'

export function AnchoredSurface({ x, y, children, label, interactive = false, onDismiss, onPointerEnter, onPointerLeave, className }: {
  x: number; y: number; children: ReactNode; label: string; interactive?: boolean
  onDismiss: () => void
  onPointerEnter?: () => void; onPointerLeave?: () => void; className?: string
}) {
  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) } }), [x, y])
  const previousFocus = useRef(document.activeElement)
  return (
    <Popover.Root open onOpenChange={(open) => { if (!open) onDismiss() }} modal={false}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          role={interactive ? 'dialog' : 'tooltip'} aria-label={label}
          side="top" align="center" sideOffset={8} collisionPadding={8}
          onOpenAutoFocus={(event) => { if (!interactive) event.preventDefault() }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (interactive && document.activeElement === document.body && previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true })
          }}
          onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
          className={cn('z-[60] w-72 max-w-[calc(100vw-1rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border border-border/70 bg-popover p-3 text-popover-foreground shadow-xl outline-none origin-[var(--radix-popover-content-transform-origin)] motion-safe:animate-[surface-in_160ms_ease-out] motion-reduce:animate-none', className)}
        >{children}</Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
