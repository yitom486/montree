import { LOCAL_WORKSPACE_ID, documentRefKey } from '@montree/contracts'
import type { DocumentRef } from '@montree/contracts'

/**
 * TanStack Query key 工厂（A1）：工作区身份进入 key，防跨工作区缓存串用（T7）。
 *
 * - local 沿用裸路径键（历史行为零变化，workspaceId 默认为 'local'）；
 * - 非 local 命名空间隔离（`workspaceId::path`，见 contracts workspace-identity）。
 * - 既有单参调用方无需改动（workspaceId 缺省），有身份处显式传入。
 */
export const queryKeys = {
  appMeta: ['app', 'meta'] as const,
  /** 历史本机槽（单窗口单工作区时代）；A1 起写入侧改走 workspaceOf。 */
  workspace: ['workspace'] as const,
  /** 按工作区身份隔离的工作区树槽（local 常驻，其他身份独立）。 */
  workspaceOf: (workspaceId: string) => ['workspace', workspaceId] as const,
  /** 工作区描述符快照（按身份缓存）。 */
  workspaceDescriptor: (workspaceId: string) => ['workspace-descriptor', workspaceId] as const,
  /** 工作区连接状态快照（推送经 setQueryData 写回，与 store 同源）。 */
  workspaceStatus: (workspaceId: string) => ['workspace-status', workspaceId] as const,
  /** 同一相对路径在不同工作区是不同文档。 */
  documentKey: (ref: DocumentRef) => ['document', documentRefKey(ref)] as const,
  readBinary: (filePath: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['read-binary', workspaceId, filePath] as const,
  readingMarks: (filePath: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['reading-marks', workspaceId, filePath] as const,
  /** 本书卡片全文搜（空 query 不建查询，调用方展示全量） */
  marksSearch: (filePath: string, query: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['reading-marks-search', workspaceId, filePath, query] as const,
  /** 该书全部搜索缓存前缀（增删改后失效搜索用） */
  marksSearchPrefix: (filePath: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['reading-marks-search', workspaceId, filePath] as const,
  webDocPage: (pageUrl: string) => ['web-doc-page', pageUrl] as const,
  webDocToc: (discoveryUrl: string) => ['web-doc-toc', discoveryUrl] as const,
  /** 按书籍路径读取测验历史 */
  quizSessions: (filePath: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['quiz-sessions', workspaceId, filePath] as const,
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
  /** Git 仓库状态（按工作区身份 + cwd 缓存，防串库）。 */
  gitStatus: (cwd: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['git-status', workspaceId, cwd] as const,
  /** B3：Git diff（按工作区身份 + cwd + 文件 + 暂存态缓存）。 */
  gitDiff: (cwd: string, file?: string, staged?: boolean, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['git-diff', workspaceId, cwd, file ?? '', staged === true] as const,
  /** B3：Git 分支列表（按工作区身份 + cwd 缓存）。 */
  gitBranches: (cwd: string, workspaceId: string = LOCAL_WORKSPACE_ID) =>
    ['git-branches', workspaceId, cwd] as const,
  /** B3：工作区检索分页（按工作区身份 + 检索词 + 页偏移缓存；取消不写缓存）。 */
  workspaceSearch: (workspaceId: string, query: string, offset: number) =>
    ['workspace-search', workspaceId, query, offset] as const,
}
