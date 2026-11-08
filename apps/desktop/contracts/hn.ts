import type { AppError, Result } from '@yitom/contracts'

export const HN_FIND_DISCUSSION_IPC = 'hn:find-discussion'

/** 与 Hacker News 官方 Firebase API 的四个列表端点一一对应 */
export type HnFeedChannel = 'top' | 'new' | 'ask' | 'show'

export interface HnFeedPayload {
  channel: HnFeedChannel
  /** 需要的条目数（1-60）。服务端按频道缓存同一批结果，未命中或过期才回源。 */
  limit?: number
  /** 从频道 id 列表的哪个位置开始（分页用） */
  offset?: number
  /** 忽略 60 分钟缓存，强制回源 */
  force?: boolean
}

export interface HnStory {
  id: number
  title: string
  /** 外链地址；Ask HN / Show HN 文本帖没有外链时为 null */
  url: string | null
  domain: string | null
  points: number
  author: string
  /** Unix 秒 */
  createdAt: number
  comments: number
  commentUrl: string
  /** 无外链文本帖的正文（HN 返回 HTML） */
  text: string | null
}

export interface HnFeedResult {
  channel: HnFeedChannel
  stories: HnStory[]
  /** 回源成功时间（毫秒） */
  fetchedAt: number
  /** 本次结果是否直接来自服务端缓存 */
  cached: boolean
  /** 频道 id 列表是否还有下一页 */
  hasMore: boolean
}

export interface HnAPI {
  /** 按文章 URL 反查 HN 讨论；没有对应帖子时返回 null */
  findDiscussion: (payload: HnFindDiscussionPayload) => Promise<Result<HnDiscussionRef | null, AppError>>
}

export interface HnFindDiscussionPayload {
  /** 文章原文 URL（HN 外链地址） */
  url: string
}

export interface HnDiscussionRef {
  /** HN item id */
  id: number
  /** HN 讨论页地址 */
  url: string
  comments: number
  title: string
}
