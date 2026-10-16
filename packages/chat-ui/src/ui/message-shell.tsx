// Copyright 2023 Vercel, Inc. Apache-2.0; see LICENSE.
// 宿主 `apps/desktop/src/components/ai-elements/message.tsx` 复刻（私有，不进 barrel；仅供包内 `AgentChatItem` 使用）。
// 唯一改动：`from` 以内联联合替代 `ai` 的 `UIMessage["role"]`（宿主调用只传 `user`/`assistant`），
// 避免给本包引入 `ai` 依赖；类名与 DOM 结构逐字。
import type { ComponentProps, HTMLAttributes } from 'react'
import { cn } from './cn'
export type MessageProps = ComponentProps<'div'> & {
  from: 'system' | 'user' | 'assistant';
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
