import React, { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Sparkles,
  BookOpen,
  CheckCircle2,
  Trophy,
  RotateCcw,
  Send,
  Loader2,
  AlertCircle,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizAnswerSubmission, QuizGrade, QuizQuestion, QuizSessionRecord } from '@montree/contracts'
import {
  evaluateAnswersWithAi,
  generateQuestionsWithAi,
} from '@/lib/quiz/quiz-evaluator'
import { resetQuizSession } from '@/lib/quiz/quiz-acp-session'
import { defaultQuizRepository } from '@/lib/quiz/quiz-storage-jsonl'
import { invalidateQuizSessions } from '@/hooks/quiz/useQuizSessions'
import { toast } from 'sonner'

export interface AiQuizDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  passage: string
  bookTitle: string
  filePath: string
  chapterTitle?: string
  markId?: string
  onNavigateToMark?: (markId: string) => void
  onOpenHistory?: () => void
}

type DialogPhase = 'generating' | 'answering' | 'grading' | 'result'

export function AiQuizDialog({
  open,
  onOpenChange,
  passage,
  bookTitle,
  filePath,
  chapterTitle,
  markId,
  onNavigateToMark,
  onOpenHistory,
}: AiQuizDialogProps) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<DialogPhase>('generating')
  const [targetCount, setTargetCount] = useState<number>(3) // 默认 3 道题
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(0)
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({})
  const [submissions, setSubmissions] = useState<Record<string, QuizAnswerSubmission>>({})
  const [totalScore, setTotalScore] = useState<number>(0)
  const [overallGrade, setOverallGrade] = useState<QuizGrade>('B')
  const [overallFeedback, setOverallFeedback] = useState<string>('')
  const [viewResultIndex, setViewResultIndex] = useState<number>(0)

  // 触发生成试卷
  const loadQuestions = useCallback(
    async (count: number) => {
      setPhase('generating')
      setQuestions([])
      setUserAnswers({})
      setSubmissions({})
      setCurrentIndex(0)
      setViewResultIndex(0)

      try {
        const { questions: qs, fallback } = await generateQuestionsWithAi(
          passage,
          count,
          chapterTitle,
          markId,
        )
        setQuestions(qs)
        if (fallback) {
          toast.warning('AI 无响应，已切换为离线启发题库')
        }
        setPhase('answering')
      } catch {
        toast.error('出题异常，已切换为离线启发题库')
        setPhase('answering')
      }
    },
    [passage, chapterTitle, markId],
  )

  useEffect(() => {
    if (!open) {
      setPhase('generating')
      setQuestions([])
      setUserAnswers({})
      setSubmissions({})
      setCurrentIndex(0)
      return
    }

    loadQuestions(targetCount)
  }, [open, loadQuestions, targetCount])

  const currentQuestion = questions[currentIndex]
  const currentAnswer = currentQuestion ? userAnswers[currentQuestion.id] || '' : ''

  // 记录单题答案
  const handleAnswerChange = (val: string) => {
    if (!currentQuestion) return
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: val,
    }))
  }

  // 提交整卷判卷
  const handleSubmitAll = async () => {
    if (questions.length === 0) return

    // 检查是否至少作答了一道
    const answeredCount = questions.filter((q) => (userAnswers[q.id] || '').trim().length > 0).length
    if (answeredCount === 0) {
      toast.warning('请至少在其中一道题中写下您的思考后再提交判卷')
      return
    }

    setPhase('grading')

    try {
      const evalResult = await evaluateAnswersWithAi(questions, userAnswers)
      setSubmissions(evalResult.submissions)
      setTotalScore(evalResult.totalScore)
      setOverallGrade(evalResult.grade)
      setOverallFeedback(evalResult.overallFeedback)

      // 保存到本地 JSONL 仓储
      const sessionRecord: QuizSessionRecord = {
        id: `session-${Date.now()}`,
        bookTitle,
        filePath,
        chapterTitle,
        createdAt: new Date().toISOString(),
        totalScore: evalResult.totalScore,
        grade: evalResult.grade,
        questions,
        submissions: evalResult.submissions,
      }

      await defaultQuizRepository.appendSession(sessionRecord)
      invalidateQuizSessions(queryClient, filePath)
      setPhase('result')
      if (evalResult.fallback) {
        toast.warning(`离线启发式判卷完成！总分：${evalResult.totalScore} 分 (${evalResult.grade})`)
      } else {
        toast.success(`AI 整卷判卷完成！总分：${evalResult.totalScore} 分 (${evalResult.grade})`)
      }
    } catch {
      toast.error('判卷过程发生异常，请重试')
      setPhase('answering')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl overflow-hidden p-6"
        aria-describedby="ai-quiz-dialog-desc"
      >
        <DialogHeader className="border-b border-border/40 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="size-4" />
              </span>
              <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
                AI 伴读考官 · 思考深度试卷
              </DialogTitle>
            </div>
            <div className="flex items-center gap-1.5">
              {/* 题量切换胶囊 */}
              {phase === 'answering' && (
                <div className="flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5 text-xs">
                  {[1, 3, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      disabled={phase !== 'answering'}
                      className={cn(
                        'px-2 py-0.5 rounded-md font-medium transition-colors text-[11px]',
                        targetCount === cnt
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => {
                        setTargetCount(cnt)
                      }}
                      title={`切换为出 ${cnt} 道题`}
                    >
                      {cnt}题
                    </button>
                  ))}
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                title="手动重置并开启全新考官会话（清空上下文记忆）"
                onClick={async () => {
                  await resetQuizSession()
                  toast.success('已重置考官会话，正在重新组卷...')
                  loadQuestions(targetCount)
                }}
              >
                <RotateCcw className="size-3.5" />
                重启会话
              </Button>
              {onOpenHistory ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenHistory()
                  }}
                >
                  <History className="size-3.5" />
                  成绩回放
                </Button>
              ) : null}
            </div>
          </div>
          <DialogDescription id="ai-quiz-dialog-desc" className="text-xs text-muted-foreground line-clamp-1">
            《{bookTitle}》· {chapterTitle || '当前章节'} · 共 {questions.length || targetCount} 题
          </DialogDescription>
        </DialogHeader>

        {/* 阶段 1：AI 正在提炼出卷 */}
        {phase === 'generating' && (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground/80">
              AI 考官正在研读文段，设计 {targetCount} 道深度思考题...
            </p>
            <p className="text-xs text-muted-foreground">
              涵盖概念认知、逻辑推演、批判反思等多元视角，激发深度思考
            </p>
          </div>
        )}

        {/* 阶段 2：多题作答界面 */}
        {phase === 'answering' && currentQuestion && (
          <div className="space-y-3.5 py-1">
            {/* 试卷题卡导航 Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {questions.map((q, idx) => {
                const isFilled = (userAnswers[q.id] || '').trim().length > 0
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all border shrink-0',
                      currentIndex === idx
                        ? 'bg-primary/10 text-primary border-primary/40 shadow-xs'
                        : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60',
                    )}
                  >
                    <span>第 {idx + 1} 题</span>
                    {q.tag ? (
                      <span className="text-[10px] px-1 py-0.2 rounded bg-primary/10 text-primary">
                        {q.tag}
                      </span>
                    ) : null}
                    {isFilled ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    ) : null}
                  </button>
                )
              })}
            </div>

            {/* 当前考题卡片 */}
            <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                  {currentQuestion.title}
                </span>
                {currentQuestion.tag ? (
                  <span className="text-xs text-muted-foreground">
                    【{currentQuestion.tag}】
                  </span>
                ) : null}
              </div>
              <p className="text-sm font-medium text-foreground leading-relaxed">
                {currentQuestion.prompt}
              </p>
            </div>

            {/* 原文微缩引述 */}
            <div className="px-3 py-1.5 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground italic line-clamp-2">
              “{currentQuestion.sourceExcerpt}”
            </div>

            {/* 作答输入区 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>你的回答与理解（第 {currentIndex + 1} / {questions.length} 题）：</span>
                <span>{currentAnswer.length} 字</span>
              </div>
              <textarea
                value={currentAnswer}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleAnswerChange(e.target.value)}
                placeholder="请阐明你的理解、推导或反思... (按 Ctrl+Enter 提交整卷判卷)"
                className="w-full rounded-md border border-input bg-muted/20 px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[110px] resize-none leading-relaxed"
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    handleSubmitAll()
                  }
                }}
              />
            </div>

            {/* 试卷底部操作条 */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={currentIndex <= 0}
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                  title="上一题"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs text-muted-foreground font-mono">
                  {currentIndex + 1} / {questions.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={currentIndex >= questions.length - 1}
                  onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                  title="下一题"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="text-xs"
                >
                  稍后再答
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="text-xs gap-1.5 bg-primary text-primary-foreground"
                  onClick={handleSubmitAll}
                >
                  <Send className="size-3.5" />
                  提交整卷 AI 判卷
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 阶段 3：AI 批量判卷评分中 */}
        {phase === 'grading' && (
          <div className="py-16 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="size-8 animate-spin text-emerald-500" />
            <p className="text-sm font-medium text-foreground/80">
              AI 考官正在全面批改整份答卷（共 {questions.length} 题）...
            </p>
            <p className="text-xs text-muted-foreground">
              深度比对原文依据，逐题组织采分点命中清单与针对性点评
            </p>
          </div>
        )}

        {/* 阶段 4：批量判卷结果展示 */}
        {phase === 'result' && questions.length > 0 && (
          <div className="space-y-3 py-1">
            {/* 整卷总分与等级看板 */}
            <div className="flex items-center justify-between p-3.5 rounded-xl border border-border/80 bg-gradient-to-r from-card to-muted/30">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-12 h-12 rounded-xl flex flex-col items-center justify-center font-bold text-lg border shadow-sm',
                    overallGrade === 'A' &&
                      'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
                    overallGrade === 'B' &&
                      'bg-blue-500/10 text-blue-500 border-blue-500/30',
                    overallGrade === 'C' &&
                      'bg-amber-500/10 text-amber-500 border-amber-500/30',
                    overallGrade === 'D' &&
                      'bg-rose-500/10 text-rose-500 border-rose-500/30',
                  )}
                >
                  {overallGrade}
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground">
                    {totalScore} <span className="text-xs font-normal text-muted-foreground">/ 100 分 · 整卷总成绩</span>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {overallFeedback}
                  </div>
                </div>
              </div>

              {/* 原书回跳按钮 */}
              {onNavigateToMark && markId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 text-primary border-primary/40 hover:bg-primary/10"
                  onClick={() => {
                    onOpenChange(false)
                    onNavigateToMark(markId)
                  }}
                >
                  <BookOpen className="size-3.5" />
                  📖 查看原书证据
                </Button>
              ) : null}
            </div>

            {/* 逐题批改切换标签 */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {questions.map((q, idx) => {
                const sub = submissions[q.id]
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setViewResultIndex(idx)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all border shrink-0',
                      viewResultIndex === idx
                        ? 'bg-primary/10 text-primary border-primary/40 shadow-xs'
                        : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60',
                    )}
                  >
                    <span>第 {idx + 1} 题</span>
                    {sub ? (
                      <span className="font-mono text-[11px] font-bold">
                        {sub.score}分
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {/* 当前题目的批改卡片 */}
            {questions[viewResultIndex] && (
              <div className="space-y-2 p-3 rounded-xl border border-border/70 bg-card/60">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px]">
                      {questions[viewResultIndex].tag || '题目分析'}
                    </span>
                    <span>{questions[viewResultIndex].title}</span>
                  </div>
                  {submissions[questions[viewResultIndex].id] && (
                    <span className="font-bold text-primary">
                      得分：{submissions[questions[viewResultIndex].id].score} 分
                    </span>
                  )}
                </div>

                {/* 读者在该题的回答 */}
                <div className="px-2.5 py-1.5 rounded-lg bg-muted/40 text-xs text-foreground/90 border border-border/40">
                  <span className="text-muted-foreground text-[10px] block">你的作答：</span>
                  {userAnswers[questions[viewResultIndex].id] || '（未作答）'}
                </div>

                {/* 采分点比对 */}
                {submissions[questions[viewResultIndex].id] && (
                  <div className="space-y-1 pt-1 text-xs">
                    <div className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                      <Trophy className="size-3 text-amber-500" />
                      采分点比对：
                    </div>
                    {submissions[questions[viewResultIndex].id].hitKeyPoints.map((kp, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-emerald-500 text-[11px]">
                        <CheckCircle2 className="size-3 shrink-0 mt-0.5" />
                        <span className="text-foreground/90">{kp}（已准确涵盖）</span>
                      </div>
                    ))}
                    {submissions[questions[viewResultIndex].id].missedKeyPoints.map((kp, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-amber-500 text-[11px]">
                        <AlertCircle className="size-3 shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{kp}（原书要点，建议深化）</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 该题导师点评 */}
                {submissions[questions[viewResultIndex].id] && (
                  <div className="p-2 rounded-lg bg-primary/5 border border-primary/15 text-[11px] space-y-0.5">
                    <span className="font-semibold text-primary block">导师点评：</span>
                    <p className="text-foreground/80 leading-relaxed">
                      {submissions[questions[viewResultIndex].id].feedback}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 底部完成与重考按钮 */}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1"
                onClick={() => {
                  setPhase('answering')
                }}
              >
                <RotateCcw className="size-3.5" />
                重新修改作答
              </Button>
              <Button
                variant="default"
                size="sm"
                className="text-xs px-5"
                onClick={() => onOpenChange(false)}
              >
                完成
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
