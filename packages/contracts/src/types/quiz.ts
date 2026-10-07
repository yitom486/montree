export type QuizQuestionType =
  | 'choice' // 客观选择题（单选/多选）
  | 'short_answer' // 概念机制简答题
  | 'essay_design' // 论述与方案设计题
  | 'subjective' // 兼容旧版主观题
  | 'boolean' // 兼容概念判断题
  | 'cloze' // 兼容挖空填空题

export interface QuizConfig {
  totalCount: number
  enabledTypes: QuizQuestionType[]
  focusOnCards?: boolean // 优先基于读者知识卡片与划线
  includeContext?: boolean // 融合章节与全书上下文延展
  countsByType?: Partial<Record<QuizQuestionType, number>>
}

export interface QuizQuestion {
  id: string
  title: string
  prompt: string
  tag?: string // 认知分类（如：概念认知、机制简析、架构设计、批判反思等）
  keyPoints: string[]
  sourceExcerpt: string
  chapterTitle?: string
  markId?: string
  type?: QuizQuestionType
  options?: string[] // 选择题选项列表，如 ["A. ...", "B. ..."]
  correctOption?: string // 正确选项标记，如 "A"
  explanation?: string // 选项深度剖析与原书依据
  designRequirements?: string[] // 论述与设计题专属：设计指标或考查要求清单
}

export type QuizGrade = 'A' | 'B' | 'C' | 'D'

export interface QuizAnswerSubmission {
  questionId: string
  userAnswer: string
  score: number // 0 ~ 100
  grade: QuizGrade
  feedback: string
  hitKeyPoints: string[]
  missedKeyPoints: string[]
  gradedAt: string
}

export interface QuizSessionRecord {
  id: string
  bookTitle: string
  filePath: string
  chapterKey?: string
  chapterTitle?: string
  createdAt: string
  totalScore: number
  grade: QuizGrade
  overallFeedback?: string // 整卷 AI 综合评语与学习诊断建议
  questions: QuizQuestion[]
  submissions: Record<string, QuizAnswerSubmission>
}

export function calculateQuizGrade(score: number): QuizGrade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}

/**
 * 序列化单条测验记录为单行 JSON
 */
export function serializeQuizSession(session: QuizSessionRecord): string {
  return `${JSON.stringify(session)}\n`
}

/**
 * 解析 JSONL 文本为 QuizSessionRecord 列表（容错跳过损坏行）
 */
export function parseQuizJsonl(raw: string): QuizSessionRecord[] {
  const lines = raw.split('\n')
  const records: QuizSessionRecord[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as QuizSessionRecord
      if (parsed && typeof parsed === 'object' && parsed.id && Array.isArray(parsed.questions)) {
        records.push(parsed)
      }
    } catch {
      // 容错跳过损坏行
    }
  }

  return records
}
