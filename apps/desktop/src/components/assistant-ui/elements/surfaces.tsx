"use client";

import type { ComponentProps } from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useIsomorphicLayoutEffect } from "../utils/useIsomorphicLayoutEffect";

export const paper = "bg-background border border-border/60 dark:bg-popover";

export const floating = "bg-background border border-border/60 dark:bg-popover";

export const field =
  "bg-muted forced-colors:border dark:bg-muted";

export const fieldInteractive =
  "bg-muted transition-colors hover:bg-accent forced-colors:border dark:bg-muted dark:hover:bg-accent";

export const pressable =
  "transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none";

export const ghostButton =
  "flex items-center justify-center rounded-full text-secondary-foreground outline-hidden transition-[background-color,color,scale] duration-150 hover:bg-muted hover:text-foreground active:scale-95 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none dark:hover:bg-accent";

export const inkButton =
  "bg-primary text-primary-foreground transition-[opacity,scale] duration-150 ease-out hover:opacity-90 active:scale-95 motion-reduce:transition-none forced-colors:border";

export const iconSwap =
  "[grid-area:1/1] transition-[opacity,scale,filter] duration-200 ease-out motion-reduce:transition-none";

export const iconSwapIn = "scale-100 opacity-100 blur-none";

export const iconSwapOut = "scale-[0.25] opacity-0 blur-[4px]";

export const labelSwap =
  "col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-none transition-[opacity,filter] duration-300 ease-out motion-reduce:transition-none";

export const labelSwapIn = "opacity-100 blur-none";

export const labelSwapOut =
  "pointer-events-none select-none opacity-0 blur-[2px]";

export const collapsePanel =
  "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";

export const live = "text-primary";

export const mono = "font-mono text-xs tracking-tight";

export function ShimmerLabel({
  active = true,
  className,
  ...props
}: ComponentProps<"span"> & { active?: boolean }) {
  return (
    <span
      className={cn(active && "shimmer motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

/**
 * Scroll region for content that keeps its own whitespace. `whitespace-pre` in
 * a bounded box clips a long line with no way to reach it, so the rows scroll
 * instead.
 *
 * `codeSurface` wraps all the rows as one block, and the rows are its children.
 * It cannot go on each row: `min-width: 100%` resolves against the scroll
 * container's visible width rather than its scroll width, so a per-row width
 * leaves every row except the longest ending its background at the fold.
 */
export const codeScroll = "overflow-x-auto";

export const codeSurface = "w-max min-w-full";

export function SwapLabel({
  active,
  children,
  className,
}: {
  active: 0 | 1;
  children: [React.ReactNode, React.ReactNode];
  className?: string;
}) {
  const layers = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const [width, setWidth] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const target = layers[active]?.current;
    if (!target) return undefined;
    const measure = () =>
      setWidth(Math.ceil(target.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [active]);

  return (
    <span
      style={width === null ? undefined : { width }}
      className={cn(
        "grid overflow-x-clip transition-[width] duration-300 ease-out motion-reduce:transition-none",
        className,
      )}
    >
      {children.map((layer, index) => (
        <span
          key={index}
          ref={layers[index]}
          aria-hidden={active !== index}
          className={cn(
            labelSwap,
            active === index ? labelSwapIn : labelSwapOut,
          )}
        >
          {layer}
        </span>
      ))}
    </span>
  );
}
