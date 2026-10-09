import { create } from 'zustand'

export interface SubsessionProgress {
  sessionId: string
  purpose: string
  /** 当前执行步骤序号（1-indexed 或根据工具/步骤递增） */
  stepCount: number
  /** 当前阶段或简要状态文案 */
  statusText: string
  /** 当前正在调用的工具名称（如 toc_replace_all、view_file） */
  currentTool?: string
  /** 当前工具执行状态 */
  toolStatus?: 'in_progress' | 'completed' | 'failed'
  /** 最近的模型思考或摘要摘录 */
  latestThought?: string
  /** 最近更新时间戳 */
  updatedAt: number
}

interface SubsessionProgressStore {
  /** 各副会话用途（如 'toc'）当前的流式进度 */
  progressByPurpose: Record<string, SubsessionProgress | null>
  setProgress: (purpose: string, progress: SubsessionProgress | null) => void
  clearProgress: (purpose: string) => void
}

/**
 * 独立副会话（如目录 AI 整理）流式执行进度存储。
 * 供悬浮看板或局部控制组件实时展示后台 Agent 状态、思考与工具调用进度。
 */
export const useSubsessionProgressStore = create<SubsessionProgressStore>((set) => ({
  progressByPurpose: {},
  setProgress: (purpose, progress) =>
    set((s) => ({
      progressByPurpose: { ...s.progressByPurpose, [purpose]: progress },
    })),
  clearProgress: (purpose) =>
    set((s) => {
      const next = { ...s.progressByPurpose }
      delete next[purpose]
      return { progressByPurpose: next }
    }),
}))
