/**
 * 在线文档阅读 IPC DTO。
 * 站点特化尽量少：generic-ssr 走通用抽取，people-daily-paper / hrtt-news 才版面特化。
 */

/** 在线文档站点适配器 id（仅保留确需版面特化的站点） */
export type WebDocSiteId = 'generic-ssr' | 'people-daily-paper' | 'hrtt-news'

export interface WebDocFetchPayload {
  url: string
}

/** 主进程 fetch 原始 HTML（未消毒；渲染端再 DOMPurify） */
export interface WebDocFetchResult {
  /** 跟随重定向后的最终 URL */
  url: string
  html: string
}

export interface WebDocDiscoverTocPayload {
  /** 文档入口 URL（用于确定 origin 与适配器） */
  url: string
}

/** 目录一项；level 从 1 起，供侧栏缩进 */
export interface WebDocTocEntry {
  href: string
  label: string
  level: number
}

export interface WebDocDiscoverTocResult {
  siteId: WebDocSiteId
  /** 默认目录（优先当前板块局部侧栏，其次全站大纲） */
  entries: WebDocTocEntry[]
  /** 当前板块/局部侧栏目录（若存在） */
  sectionEntries?: WebDocTocEntry[]
  /** 站点级/全站大纲目录（如从 llms.txt 解析，若存在） */
  siteEntries?: WebDocTocEntry[]
}

/** 渲染端净化后的单页阅读内容 */
export interface WebDocPageContent {
  title: string
  bodyHtml: string
  baseUrl: string
  siteId: WebDocSiteId
}
