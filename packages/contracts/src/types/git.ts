export type GitFileStatusCode = 'modified' | 'untracked' | 'deleted' | 'added' | 'renamed' | 'conflict'

export interface GitFileStatus {
  path: string
  status: GitFileStatusCode
  staged: boolean
}

export interface GitStatusResult {
  /** 当前工作区目录是否为一个 Git 仓库 */
  isRepo: boolean
  /** 当前活动分支名（如 main / master / feature-blog），游离头指针或非仓库为 null */
  branch: string | null
  /** 本地落后远程分支 commit 数量 */
  behind: number
  /** 本地领先远程分支待 push 的 commit 数量 */
  ahead: number
  /** 当前分支是否已关联上游分支（无上游时推送需先发布分支） */
  hasUpstream: boolean
  /** 改动文件列表 */
  files: GitFileStatus[]
  /** 未暂存或已暂存的总文件改动数 */
  totalChanges: number
}

export interface GitPushOptions {
  remote?: string
  branch?: string
  setUpstream?: boolean
}

export interface GitPushResult {
  success: boolean
  stdout?: string
}

export interface GitCommitOptions {
  message: string
  stageAll?: boolean
}

export interface GitCommitResult {
  success: boolean
  commitHash?: string
  message?: string
}

/** B3：单文件/整树 diff（过长截断并标记，不静默丢尾） */
export interface GitDiffResult {
  /** 省略时为整树未暂存 diff（含 --stat 头部由调用方裁剪展示） */
  file?: string
  diff: string
  truncated: boolean
}

/** B3：分支列表（游离 HEAD 时 current 为 null 且 detached） */
export interface GitBranchInfo {
  current: string | null
  branches: string[]
  detached: boolean
}
