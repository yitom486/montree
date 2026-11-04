import type { AppError, Result } from '@yitom/contracts'

export const FEED_FETCH_IPC = 'feed:fetch'
export const FEED_AUTH_LOGIN_IPC = 'feed:auth:login'
export const FEED_AUTH_STATUS_IPC = 'feed:auth:status'
export const FEED_AUTH_LOGOUT_IPC = 'feed:auth:logout'

export type FeedSourceId = 'hacker-news' | 'lobsters' | 'rss' | 'arxiv' | 'ai' | 'linux-do'

export interface FeedChannelDefinition {
  id: string
  label: string
}

export interface FeedSourceDefinition {
  id: FeedSourceId
  label: string
  description: string
  channels: FeedChannelDefinition[]
  /** 需要登录的来源：渲染端展示登录入口，主进程打开真实登录窗口 */
  auth?: {
    loginUrl: string
  }
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
  {
    id: 'ai',
    label: 'AI 前沿',
    description: '模型厂商与研究团队的最新动态',
    channels: [
      { id: 'claude', label: 'Claude' },
      { id: 'huggingface', label: 'Hugging Face' },
      { id: 'openai', label: 'OpenAI' },
      { id: 'deepmind', label: 'DeepMind' },
      { id: 'google-ai', label: 'Google AI' },
      { id: 'bair', label: 'BAIR' },
      { id: 'import-ai', label: 'Import AI' },
    ],
  },
  {
    id: 'linux-do',
    label: 'Linux.do',
    description: '中文技术社区，需要登录',
    auth: { loginUrl: 'https://linux.do/login' },
    channels: [
      { id: 'latest', label: '最新' },
      { id: 'top', label: '热门' },
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
  /** 0 起始页码 */
  page?: number
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
  /** 0 起始页码 */
  page: number
  items: FeedItem[]
  fetchedAt: number
  cached: boolean
  /** 是否还有下一页 */
  hasMore: boolean
  /** RSS/Atom 自带标题；用于自定义订阅自动命名 */
  feedTitle?: string
}

export interface FeedAPI {
  fetch: (payload: FeedFetchPayload) => Promise<Result<FeedResult, AppError>>
}

export interface FeedAuthStatus {
  authenticated: boolean
  /** 登录态探测到的用户名 */
  user?: string
  /** 被站点 WAF 拦截，登录窗口也未必可用 */
  blocked?: boolean
}

export interface FeedAuthAPI {
  login: (source: FeedSourceId) => Promise<Result<FeedAuthStatus, AppError>>
  status: (source: FeedSourceId) => Promise<Result<FeedAuthStatus, AppError>>
  logout: (source: FeedSourceId) => Promise<Result<void, AppError>>
}

/** 登录窗口与主进程抓取共用，避免 UA 不一致导致 Cloudflare 登录态失效 */
export const FEED_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Montree/0.4.30'

/** 每个登录来源独立的持久化分区，避免 Cookie 串站 */
export function feedAuthPartition(source: FeedSourceId): string {
  return `persist:montree-feed-auth-${source}`
}
