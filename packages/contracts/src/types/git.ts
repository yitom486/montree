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
