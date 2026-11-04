import type { AppError, Result } from '@yitom/contracts'

export const FEED_FETCH_IPC = 'feed:fetch'

export type FeedSourceId = 'hacker-news' | 'lobsters' | 'rss' | 'arxiv'

export interface FeedChannelDefinition {
  id: string
  label: string
}

export interface FeedSourceDefinition {
  id: FeedSourceId
  label: string
  description: string
  channels: FeedChannelDefinition[]
}

/**
 * 资讯源注册表：主进程按 source + channel 分发适配器，渲染端只认这份定义。
 * 新增来源时同时补 `FEED_SOURCES` 与主进程 adapter。
 */
export const FEED_SOURCES: FeedSourceDefinition[] = [
  {
    id: 'hacker-news',
    label: 'Hacker News',
    description: '技术社区热度与讨论',
    channels: [
      { id: 'top', label: '热门' },
      { id: 'new', label: '最新' },
      { id: 'ask', label: 'Ask HN' },
      { id: 'show', label: 'Show HN' },
    ],
  },
  {
    id: 'lobsters',
    label: 'Lobsters',
    description: '硬核工程与系统编程',
    channels: [
      { id: 'hottest', label: '热门' },
      { id: 'newest', label: '最新' },
    ],
  },
  {
    id: 'rss',
    label: '技术博客',
    description: '精选技术博客与厂商工程博客',
    channels: [
      { id: 'sspai', label: '少数派' },
      { id: 'ruanyifeng', label: '阮一峰' },
      { id: 'ars', label: 'Ars Technica' },
      { id: 'cloudflare', label: 'Cloudflare' },
    ],
  },
  {
    id: 'arxiv',
    label: 'arXiv',
    description: '计算机科学最新预印本',
    channels: [
      { id: 'cs-ai', label: '人工智能' },
      { id: 'cs-lg', label: '机器学习' },
      { id: 'cs-pl', label: '编程语言' },
      { id: 'cs-dc', label: '分布式系统' },
    ],
  },
]

export const DEFAULT_FEED_SOURCE: FeedSourceId = 'hacker-news'

export function findFeedSource(id: FeedSourceId): FeedSourceDefinition {
  return FEED_SOURCES.find((source) => source.id === id) ?? FEED_SOURCES[0]!
}

export interface FeedFetchPayload {
  source: FeedSourceId
  channel: string
  limit?: number
  force?: boolean
}

export interface FeedItem {
  /** 源内唯一 id（字符串化，便于统一 key） */
  id: string
  source: FeedSourceId
  title: string
  /** 外链地址；纯文本帖没有外链时为 null */
  url: string | null
  domain: string | null
  points: number
  author: string
  /** Unix 秒 */
  createdAt: number
  comments: number
  /** 讨论页；没有独立讨论页时等于原文地址 */
  discussionUrl: string
  /** 无外链文本帖正文（HN Ask/Show） */
  text?: string | null
}

export interface FeedResult {
  source: FeedSourceId
  channel: string
  items: FeedItem[]
  fetchedAt: number
  cached: boolean
  /** RSS/Atom 自带标题；用于自定义订阅自动命名 */
  feedTitle?: string
}

export interface FeedAPI {
  fetch: (payload: FeedFetchPayload) => Promise<Result<FeedResult, AppError>>
}
