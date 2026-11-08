# assistant-ui registry components

Installed through `bunx --bun shadcn@latest add https://r.assistant-ui.com/elements-option-list.json` (2026-11-08). Source: [assistant-ui](https://github.com/assistant-ui/assistant-ui), MIT. Only typography, theme tokens and spacing were adapted; selection, pending-state and focus behavior remain upstream.

| File | Purpose |
| --- | --- |
| `elements/option-list.tsx` | Single/multiple selection, asynchronous confirmation and settled receipts |
| `elements/receipt-focus.ts` | Retains keyboard focus when an option list becomes a receipt |
| `elements/surfaces.tsx` | Registry surface, typography, reduced-motion and label recipes; shimmer dependency is installed by the registry |
| `utils/range.ts` | Bounds option-selection counts |
| `utils/useIsomorphicLayoutEffect.ts` | SSR-safe layout effect used by registry focus helpers |

The ACP host composes these components with installed shadcn controls; it does not replace the existing chat runtime or message feed.
