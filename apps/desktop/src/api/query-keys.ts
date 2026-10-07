export const queryKeys = {
  appMeta: ['app', 'meta'] as const,
  workspace: ['workspace'] as const,
  readBinary: (filePath: string) => ['read-binary', filePath] as const,
  readingMarks: (filePath: string) => ['reading-marks', filePath] as const,
  /** 本书卡片全文搜（空 query 不建查询，调用方展示全量） */
  marksSearch: (filePath: string, query: string) =>
    ['reading-marks-search', filePath, query] as const,
  /** 该书全部搜索缓存前缀（增删改后失效搜索用） */
  marksSearchPrefix: (filePath: string) => ['reading-marks-search', filePath] as const,
  webDocPage: (pageUrl: string) => ['web-doc-page', pageUrl] as const,
  webDocToc: (discoveryUrl: string) => ['web-doc-toc', discoveryUrl] as const,
  /** 按书籍路径读取测验历史 */
  quizSessions: (filePath: string) => ['quiz-sessions', filePath] as const,
  /** WebDAV 同步配置（表单种子，仅初始读取） */
  syncConfig: ['sync', 'config'] as const,
  /** 同步状态快照（onStatusChanged 推送经 setQueryData 写回缓存） */
  syncStatus: ['sync', 'status'] as const,
  /** 罗盘某书索引信息（按 fingerprint 缓存；导入完成/重建后失效） */
  rosettaBookInfo: (fingerprint: string) => ['rosetta-book-info', fingerprint] as const,
  /** OCR 组件（语言包/引擎）状态（onOcrComponentStatus 推送经 setQueryData 写回） */
  ocrComponent: ['ocr', 'component-status'] as const,
  /** TTS 语音配置与缓存统计 */
  ttsConfig: ['tts', 'config'] as const,
  ttsCacheStats: ['tts', 'cache-stats'] as const,
}
