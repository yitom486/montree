import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  QuizAnswerSubmission,
  QuizConfig,
  QuizGrade,
  QuizQuestion,
  QuizQuestionType,
  QuizSessionRecord,
} from '@montree/contracts'
import {
  evaluateAnswersWithAi,
  generateQuestionsWithAi,
} from '@/lib/quiz/quiz-evaluator'
import { resetQuizSession } from '@/lib/quiz/quiz-acp-session'
import { defaultQuizRepository } from '@/lib/quiz/quiz-storage-jsonl'
import { invalidateQuizSessions } from '@/hooks/quiz/useQuizSessions'
import { toast } from 'sonner'

export type DialogPhase = 'config' | 'generating' | 'answering' | 'grading' | 'result'

export interface UseQuizSessionStateOptions {
  open: boolean
  passage: string
  bookTitle: string
  filePath: string
  chapterTitle?: string
  markId?: string
}

export function useQuizSessionState({
  open,
  passage,
  bookTitle,
  filePath,
  chapterTitle,
  markId,
}: UseQuizSessionStateOptions) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<DialogPhase>('config')
  const [targetCount, setTargetCount] = useState<number>(3)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(0)
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({})
  const [submissions, setSubmissions] = useState<Record<string, QuizAnswerSubmission>>({})
  const [totalScore, setTotalScore] = useState<number>(0)
  const [overallGrade, setOverallGrade] = useState<QuizGrade>('B')
  const [overallFeedback, setOverallFeedback] = useState<string>('')
  const [viewResultIndex, setViewResultIndex] = useState<number>(0)
  const [showExcerptPanel, setShowExcerptPanel] = useState<boolean>(true)
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false)
  const [enabledTypes, setEnabledTypes] = useState<QuizQuestionType[]>([
    'choice',
    'short_answer',
    'essay_design',
  ])
  const [focusOnCards, setFocusOnCards] = useState<boolean>(true)
  const [includeContext, setIncludeContext] = useState<boolean>(true)

  const loadQuestions = useCallback(
    async (count: number, customConfig?: QuizConfig) => {
      setPhase('generating')
      setQuestions([])
      setUserAnswers({})
      setSubmissions({})
      setCurrentIndex(0)
      setViewResultIndex(0)

      const cfg: QuizConfig = customConfig || {
        totalCount: count,
        enabledTypes,
        focusOnCards,
        includeContext,
      }

      try {
        const { questions: qs, fallback } = await generateQuestionsWithAi(
          passage,
          count,
          chapterTitle,
          markId,
          cfg,
        )
        setQuestions(qs)
        if (fallback) {
          toast.warning('AI 考官无响应，已平滑切换为离线启发题库')
        }
        setPhase('answering')
      } catch {
        toast.error('组卷异常，已切换为离线启发题库')
        setPhase('answering')
      }
    },
    [passage, chapterTitle, markId, enabledTypes, focusOnCards, includeContext],
  )

  useEffect(() => {
    if (!open) {
      setPhase('config')
      setQuestions([])
      setUserAnswers({})
      setSubmissions({})
      setCurrentIndex(0)
      setShowConfigDrawer(false)
      return
    }
    setPhase('config')
  }, [open])

  const currentQuestion = questions[currentIndex]
  const currentAnswer = currentQuestion ? userAnswers[currentQuestion.id] || '' : ''

  const handleSelectOption = (opt: string) => {
    if (!currentQuestion) return
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: opt,
    }))
  }

  const handleAnswerChange = (val: string) => {
    if (!currentQuestion) return
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: val,
    }))
  }

  const toggleQuestionType = (type: QuizQuestionType) => {
    setEnabledTypes((prev) => {
      if (prev.includes(type)) {
        if (prev.length <= 1) {
          toast.info('试卷至少需要保留一种出题类型')
          return prev
        }
        return prev.filter((t) => t !== type)
      }
      return [...prev, type]
    })
  }

  const handleSubmitAll = async () => {
    if (questions.length === 0) return

    const answeredCount = questions.filter((q) => (userAnswers[q.id] || '').trim().length > 0).length
    if (answeredCount === 0) {
      toast.warning('请至少在其中一道题中做出选择或写下思考后再提交判卷')
      return
    }

    setPhase('grading')

    try {
      const evalResult = await evaluateAnswersWithAi(questions, userAnswers)
      setSubmissions(evalResult.submissions)
      setTotalScore(evalResult.totalScore)
      setOverallGrade(evalResult.grade)
      setOverallFeedback(evalResult.overallFeedback)

      const sessionRecord: QuizSessionRecord = {
        id: `session-${Date.now()}`,
        bookTitle,
        filePath,
        chapterTitle,
        createdAt: new Date().toISOString(),
        totalScore: evalResult.totalScore,
        grade: evalResult.grade,
        overallFeedback: evalResult.overallFeedback,
        questions,
        submissions: evalResult.submissions,
      }

      await defaultQuizRepository.appendSession(sessionRecord)
      invalidateQuizSessions(queryClient, filePath)
      setPhase('result')
      if (evalResult.fallback) {
        toast.warning(`启发式判卷完成！整卷得分：${evalResult.totalScore} 分 (${evalResult.grade})`)
      } else {
        toast.success(`AI 考官整卷判卷完成！总分：${evalResult.totalScore} 分 (${evalResult.grade})`)
      }
    } catch {
      toast.error('判卷过程发生异常，请重试')
      setPhase('answering')
    }
  }

  const resetSessionAndReload = async () => {
    await resetQuizSession()
    toast.success('已重置考官记忆，正在重新组卷...')
    loadQuestions(targetCount)
  }

  return {
    phase,
    setPhase,
    targetCount,
    setTargetCount,
    questions,
    currentIndex,
    setCurrentIndex,
    currentQuestion,
    currentAnswer,
    userAnswers,
    submissions,
    totalScore,
    overallGrade,
    overallFeedback,
    viewResultIndex,
    setViewResultIndex,
    showExcerptPanel,
    setShowExcerptPanel,
    showConfigDrawer,
    setShowConfigDrawer,
    enabledTypes,
    focusOnCards,
    setFocusOnCards,
    includeContext,
    setIncludeContext,
    loadQuestions,
    handleSelectOption,
    handleAnswerChange,
    toggleQuestionType,
    handleSubmitAll,
    resetSessionAndReload,
  }
}
