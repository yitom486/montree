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
  Maximize2,
  Minimize2,
  Check,
  XCircle,
  HelpCircle,
  FileText,
  Layers,
  SlidersHorizontal,
  Settings2,
  CheckSquare,
  Square,
  GraduationCap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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

type DialogPhase = 'config' | 'generating' | 'answering' | 'grading' | 'result'

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
  const [isMaximized, setIsMaximized] = useState(false)
  const [phase, setPhase] = useState<DialogPhase>('config')
  const [targetCount, setTargetCount] = useState<number>(3) // 默认 3 道题
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(0)
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({})
  const [submissions, setSubmissions] = useState<Record<string, QuizAnswerSubmission>>({})
  const [totalScore, setTotalScore] = useState<number>(0)
  const [overallGrade, setOverallGrade] = useState<QuizGrade>('B')
  const [overallFeedback, setOverallFeedback] = useState<string>('')
  const [viewResultIndex, setViewResultIndex] = useState<number>(0)
  const [showExcerptPanel, setShowExcerptPanel] = useState<boolean>(true)

  // 试卷个性化定制配置面板
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false)
  const [enabledTypes, setEnabledTypes] = useState<QuizQuestionType[]>([
    'choice',
    'short_answer',
    'essay_design',
  ])
  const [focusOnCards, setFocusOnCards] = useState<boolean>(true)
  const [includeContext, setIncludeContext] = useState<boolean>(true)

  // 触发生成试卷
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

    // 每次打开弹窗，默认呈现出题配置与历史卷库向导台
    setPhase('config')
  }, [open])

  const currentQuestion = questions[currentIndex]
  const currentAnswer = currentQuestion ? userAnswers[currentQuestion.id] || '' : ''

  // 记录单题答案（论述手写或选择题点击）
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

  // 切换题型选择勾选
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

  // 提交整卷判卷并落库
  const handleSubmitAll = async () => {
    if (questions.length === 0) return

    // 检查是否至少作答了一道
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

      // 保存到本地数据库（JSONL + SQLite 双模高可靠链路，完整落库成绩、单题点评与整卷 AI 诊断建议）
      const sessionRecord: QuizSessionRecord = {
        id: `session-${Date.now()}`,
        bookTitle,
        filePath,
        chapterTitle,
        createdAt: new Date().toISOString(),
        totalScore: evalResult.totalScore,
        grade: evalResult.grade,
        overallFeedback: evalResult.overallFeedback, // 完整落库 AI 导师综合评价与学习建议
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'bg-card/95 backdrop-blur-2xl border border-border/80 shadow-2xl transition-all duration-300 flex flex-col overflow-hidden',
          isMaximized
            ? 'fixed inset-3 max-w-none w-auto h-[calc(100vh-1.5rem)] rounded-2xl p-6 z-50'
            : 'max-w-3xl w-full max-h-[92vh] rounded-xl p-5',
        )}
        aria-describedby="ai-quiz-dialog-desc"
      >
        {/* 顶部工坊导航栏 */}
        <DialogHeader className="border-b border-border/40 pb-3 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-1.5 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary border border-primary/25 shadow-xs shrink-0">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
                  <span>AI 智考工坊</span>
                  <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    深度认知评估
                  </span>
                </DialogTitle>
                <DialogDescription id="ai-quiz-dialog-desc" className="text-xs text-muted-foreground truncate">
                  《{bookTitle}》· {chapterTitle || '当前章节'} · 共 {questions.length || targetCount} 题
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* 试卷配置抽屉开关 */}
              {phase === 'answering' && (
                <Button
                  variant={showConfigDrawer ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => setShowConfigDrawer((v) => !v)}
                  title="自定义配置试卷题型、题量与考察侧重"
                >
                  <SlidersHorizontal className="size-3.5" />
                  <span>定制试卷</span>
                </Button>
              )}

              {/* 题量选择快速切换胶囊 */}
              {phase === 'answering' && (
                <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5 text-xs">
                  {[1, 3, 5, 8].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      disabled={phase !== 'answering'}
                      className={cn(
                        'px-2 py-0.5 rounded-md font-medium transition-colors text-[11px] cursor-pointer',
                        targetCount === cnt
                          ? 'bg-background text-foreground shadow-xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => {
                        setTargetCount(cnt)
                        loadQuestions(cnt)
                      }}
                      title={`重新组卷出 ${cnt} 道题`}
                    >
                      {cnt}题
                    </button>
                  ))}
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                title="手动重置并开启全新考官会话（清空上下文记忆）"
                onClick={async () => {
                  await resetQuizSession()
                  toast.success('已重置考官记忆，正在重新组卷...')
                  loadQuestions(targetCount)
                }}
              >
                <RotateCcw className="size-3.5" />
                <span>重开</span>
              </Button>

              {onOpenHistory ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenHistory()
                  }}
                  title="查看历史考卷与错题复盘"
                >
                  <History className="size-3.5" />
                  <span>卷库</span>
                </Button>
              ) : null}

              {/* 最大化 / 还原双模切换按钮 */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => setIsMaximized((v) => !v)}
                title={isMaximized ? '退出全屏工作台' : '展开为全屏沉浸工坊'}
              >
                {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* 试卷个性化定制展开面板 */}
        {showConfigDrawer && phase === 'answering' && (
          <div className="border-b border-border/60 bg-muted/20 p-3 rounded-lg mx-0.5 space-y-2.5 text-xs animate-in fade-in-50 duration-200">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Settings2 className="size-3.5 text-primary" />
                <span>试卷结构与考察偏好配置</span>
              </span>
              <span className="text-[11px]">按勾选项即时生效定制</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* 题型勾选 */}
              <div className="p-2 rounded-md bg-background/80 border border-border/60 space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground block">考查题型组合：</span>
                <div className="space-y-1">
                  {[
                    { type: 'choice' as QuizQuestionType, label: '客观选择题 (Choice)' },
                    { type: 'short_answer' as QuizQuestionType, label: '机制简答题 (Short Answer)' },
                    { type: 'essay_design' as QuizQuestionType, label: '论述与设计题 (Essay & Design)' },
                  ].map((item) => {
                    const checked = enabledTypes.includes(item.type)
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => toggleQuestionType(item.type)}
                        className={cn(
                          'w-full flex items-center gap-1.5 text-left text-[11px] px-1.5 py-1 rounded transition-colors',
                          checked ? 'text-primary font-medium bg-primary/10' : 'text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        {checked ? <CheckSquare className="size-3.5 text-primary" /> : <Square className="size-3.5 text-muted-foreground/60" />}
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 题源侧重 */}
              <div className="p-2 rounded-md bg-background/80 border border-border/60 space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground block">知识题源侧重：</span>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setFocusOnCards((v) => !v)}
                    className={cn(
                      'w-full flex items-center gap-1.5 text-left text-[11px] px-1.5 py-1 rounded transition-colors',
                      focusOnCards ? 'text-primary font-medium bg-primary/10' : 'text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {focusOnCards ? <CheckSquare className="size-3.5 text-primary" /> : <Square className="size-3.5 text-muted-foreground/60" />}
                    <span>优先读者知识卡与高亮重点</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeContext((v) => !v)}
                    className={cn(
                      'w-full flex items-center gap-1.5 text-left text-[11px] px-1.5 py-1 rounded transition-colors',
                      includeContext ? 'text-primary font-medium bg-primary/10' : 'text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {includeContext ? <CheckSquare className="size-3.5 text-primary" /> : <Square className="size-3.5 text-muted-foreground/60" />}
                    <span>融合章节全书上下文深度延展</span>
                  </button>
                </div>
              </div>

              {/* 快速重新组卷动作 */}
              <div className="p-2 rounded-md bg-background/80 border border-border/60 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-muted-foreground block">当前题量规划：</span>
                  <span className="text-xs font-bold text-foreground mt-0.5 block">{targetCount} 道系统考题</span>
                </div>
                <Button
                  size="sm"
                  className="w-full text-xs h-7 gap-1.5 font-semibold cursor-pointer mt-2"
                  onClick={() => {
                    loadQuestions(targetCount, {
                      totalCount: targetCount,
                      enabledTypes,
                      focusOnCards,
                      includeContext,
                    })
                    toast.success('已应用试卷定制配置，正在重新出题...')
                  }}
                >
                  <Sparkles className="size-3.5" />
                  <span>按此配置重新出卷</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 主内容区域 */}
        <div className="flex-1 overflow-y-auto py-2 px-0.5 space-y-4">
          {/* 阶段 0：试卷个性化定制与历史向导准备台 */}
          {phase === 'config' && (
            <div className="py-2 space-y-4">
              {/* 考场横幅 */}
              <div className="p-4 rounded-xl border border-primary/25 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent flex items-start justify-between gap-3 shadow-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-primary/20 text-primary">
                      <GraduationCap className="size-4.5" />
                    </span>
                    <h3 className="font-bold text-sm text-foreground">AI 智能考官出卷准备台</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    根据《{bookTitle}》{chapterTitle ? `【${chapterTitle}】` : ''} 的重点卡片与原书论述，由 AI 针对性量身定制深度试卷。
                  </p>
                </div>

                {onOpenHistory && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-8 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10 font-semibold cursor-pointer shadow-xs"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenHistory()
                    }}
                  >
                    <History className="size-3.5" />
                    <span>查看历史试卷库</span>
                  </Button>
                )}
              </div>

              {/* 题源与考查依据预览条 */}
              <div className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <BookOpen className="size-3.5 text-primary" />
                    <span>考查依据与重点摘录：</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowExcerptPanel((v) => !v)}
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                  >
                    {showExcerptPanel ? '收起摘录' : '展开原文摘录'}
                  </button>
                </div>
                {showExcerptPanel && (
                  <div className="p-2.5 rounded-lg bg-background/80 border border-border/50 text-[11px] text-muted-foreground italic leading-relaxed max-h-28 overflow-y-auto border-l-2 border-primary">
                    "{passage.trim().slice(0, 300)}{passage.trim().length > 300 ? '……' : ''}"
                  </div>
                )}
              </div>

              {/* 定制网格：题量与题型 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* 1. 题量规划 */}
                <div className="p-3.5 rounded-xl border border-border/60 bg-card space-y-2.5 shadow-xs">
                  <span className="font-semibold text-foreground block text-xs flex items-center gap-1.5">
                    <SlidersHorizontal className="size-3.5 text-primary" />
                    <span>本次出题数量规划：</span>
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { count: 3, label: '3 题', desc: '快速自测' },
                      { count: 5, label: '5 题', desc: '标准精测' },
                      { count: 8, label: '8 题', desc: '深度大考' },
                    ].map((item) => {
                      const isSelected = targetCount === item.count
                      return (
                        <button
                          key={item.count}
                          type="button"
                          onClick={() => setTargetCount(item.count)}
                          className={cn(
                            'p-2 rounded-lg border text-center transition-all cursor-pointer select-none',
                            isSelected
                              ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                              : 'border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                          )}
                        >
                          <span className="text-xs block font-bold">{item.label}</span>
                          <span className="text-[10px] text-muted-foreground/80 block mt-0.5">{item.desc}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 2. 题型组合多选 */}
                <div className="p-3.5 rounded-xl border border-border/60 bg-card space-y-2.5 shadow-xs">
                  <span className="font-semibold text-foreground block text-xs flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" />
                    <span>涵盖系统题型（可多选组合）：</span>
                  </span>
                  <div className="space-y-1.5">
                    {[
                      {
                        type: 'choice' as QuizQuestionType,
                        label: '客观选择题 (Choice)',
                        desc: '概念辨析与事实推断，带4项依据剖析',
                      },
                      {
                        type: 'short_answer' as QuizQuestionType,
                        label: '机制简答题 (Short Answer)',
                        desc: '因果逻辑与运行流程，考查原理解构',
                      },
                      {
                        type: 'essay_design' as QuizQuestionType,
                        label: '场景设计题 (Essay & Design)',
                        desc: '真实场景系统架构方案设计与权衡',
                      },
                    ].map((item) => {
                      const checked = enabledTypes.includes(item.type)
                      return (
                        <button
                          key={item.type}
                          type="button"
                          onClick={() => toggleQuestionType(item.type)}
                          className={cn(
                            'w-full flex items-start gap-2 p-1.5 rounded-lg border text-left transition-all cursor-pointer',
                            checked
                              ? 'border-primary/40 bg-primary/5 text-primary'
                              : 'border-border/40 bg-muted/10 text-muted-foreground hover:bg-muted/30',
                          )}
                        >
                          <span className="mt-0.5 shrink-0">
                            {checked ? <CheckSquare className="size-3.5 text-primary" /> : <Square className="size-3.5 text-muted-foreground/60" />}
                          </span>
                          <div className="min-w-0">
                            <span className="font-semibold text-[11px] block text-foreground">{item.label}</span>
                            <span className="text-[10px] text-muted-foreground block leading-tight">{item.desc}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* 3. 题源偏好 */}
              <div className="p-3 rounded-xl border border-border/60 bg-card/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-muted-foreground text-xs">出题导师侧重点：</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setFocusOnCards((v) => !v)}
                    className={cn(
                      'flex items-center gap-1.5 text-xs transition-colors cursor-pointer select-none',
                      focusOnCards ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {focusOnCards ? <CheckSquare className="size-3.5 text-primary" /> : <Square className="size-3.5 text-muted-foreground" />}
                    <span>优先基于我的高亮卡片</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeContext((v) => !v)}
                    className={cn(
                      'flex items-center gap-1.5 text-xs transition-colors cursor-pointer select-none',
                      includeContext ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {includeContext ? <CheckSquare className="size-3.5 text-primary" /> : <Square className="size-3.5 text-muted-foreground" />}
                    <span>融入全书上下文延展</span>
                  </button>
                </div>
              </div>

              {/* 底部行动主按钮 */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs cursor-pointer gap-1"
                  onClick={() => {
                    loadQuestions(3, {
                      totalCount: 3,
                      enabledTypes: ['choice', 'short_answer', 'essay_design'],
                      focusOnCards: true,
                      includeContext: true,
                    })
                  }}
                >
                  <Sparkles className="size-3.5 text-amber-500" />
                  <span>快速测验 (默认3题)</span>
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  className="text-xs px-5 cursor-pointer font-bold gap-1.5 shadow-sm"
                  onClick={() => {
                    loadQuestions(targetCount)
                  }}
                >
                  <GraduationCap className="size-4" />
                  <span>开始定制出卷 ({targetCount}题)</span>
                </Button>
              </div>
            </div>
          )}

          {/* 阶段 1：AI 出卷生成中 */}
          {phase === 'generating' && (
            <div className="py-20 flex flex-col items-center justify-center space-y-3.5 text-center">
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-pulse">
                  <Sparkles className="size-6 text-primary animate-spin" />
                </div>
              </div>
              <p className="text-sm font-semibold text-foreground tracking-tight">
                AI 考官正在研读文段，设计 {targetCount} 道深度考核题...
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                融合单选辨析、逻辑推演与深度论述，多维衡量对核心观点的掌握度
              </p>
            </div>
          )}

          {/* 阶段 2：交互作答界面（支持选择题与主观题多模态渲染） */}
          {phase === 'answering' && currentQuestion && (
            <div className="space-y-4">
              {/* 题卡导航条 */}
              <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
                <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {questions.map((q, idx) => {
                    const isFilled = (userAnswers[q.id] || '').trim().length > 0
                    const isChoice = q.type === 'choice'
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCurrentIndex(idx)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border shrink-0 cursor-pointer',
                          currentIndex === idx
                            ? 'bg-primary/15 text-primary border-primary/40 shadow-xs font-semibold'
                            : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60',
                        )}
                      >
                        <span>第 {idx + 1} 题</span>
                        <span className="text-[9.5px] px-1 py-0.2 rounded bg-primary/10 text-primary">
                          {isChoice ? '选择' : '问答'}
                        </span>
                        {isFilled && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>

                <div className="text-xs text-muted-foreground font-mono shrink-0">
                  {currentIndex + 1} / {questions.length}
                </div>
              </div>

              {/* 题干展示主卡片 */}
              <div className="p-4 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-background space-y-2 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-primary px-2 py-0.5 rounded-md bg-primary/15 border border-primary/25">
                      {currentQuestion.title}
                    </span>
                    {currentQuestion.tag && (
                      <span className="text-xs text-muted-foreground">
                        【{currentQuestion.tag}】
                      </span>
                    )}
                  </div>
                  <span className="text-[10.5px] text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded">
                    {currentQuestion.type === 'choice' ? '单项选择题' : '深度论述题'}
                  </span>
                </div>

                <p className="text-sm font-medium text-foreground leading-relaxed pt-1">
                  {currentQuestion.prompt}
                </p>
              </div>

              {/* 原文证据链抽屉 */}
              {currentQuestion.sourceExcerpt && (
                <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setShowExcerptPanel((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/40 text-muted-foreground hover:text-foreground cursor-pointer text-[11px]"
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <FileText className="size-3.5 text-primary" />
                      <span>原书引述依据</span>
                    </span>
                    <span className="text-[10px]">{showExcerptPanel ? '收起' : '展开'}</span>
                  </button>
                  {showExcerptPanel && (
                    <div className="p-3 text-muted-foreground/90 italic leading-relaxed border-t border-border/40 font-serif">
                      “{currentQuestion.sourceExcerpt}”
                    </div>
                  )}
                </div>
              )}

              {/* 多模态作答区 */}
              {currentQuestion.type === 'choice' && currentQuestion.options && currentQuestion.options.length > 0 ? (
                /* A. 选择题渲染器（微晶立体选项卡） */
                <div className="space-y-2 pt-1">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <span>请选择最符合原书逻辑的选项：</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {currentQuestion.options.map((opt, optIdx) => {
                      const optLetter = opt.trim().charAt(0)
                      const isSelected =
                        currentAnswer === opt ||
                        currentAnswer === optLetter ||
                        currentAnswer.startsWith(optLetter + '.') ||
                        currentAnswer.startsWith(optLetter + '、')

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleSelectOption(opt)}
                          className={cn(
                            'w-full flex items-center justify-between p-3 rounded-xl border text-left text-xs transition-all duration-200 cursor-pointer',
                            isSelected
                              ? 'bg-primary/15 border-primary/50 text-foreground font-medium shadow-xs ring-1 ring-primary/40'
                              : 'bg-card/70 border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                'w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 transition-colors',
                                isSelected
                                  ? 'bg-primary text-primary-foreground shadow-xs'
                                  : 'bg-muted text-muted-foreground border border-border/60',
                              )}
                            >
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <span className="leading-relaxed">{opt.replace(/^[A-D][.、\s]*/, '')}</span>
                          </div>
                          {isSelected && <Check className="size-4 text-primary shrink-0 ml-2" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                /* B. 主观论述题渲染器（手写输入 + 实时字数统计） */
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>你的阐述与见解：</span>
                    <span className="font-mono">{currentAnswer.length} 字</span>
                  </div>
                  <textarea
                    value={currentAnswer}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleAnswerChange(e.target.value)}
                    placeholder="阐明你的推导依据、论证逻辑或反思（按 Ctrl+Enter 快捷提交整卷判卷）..."
                    className="w-full rounded-xl border border-input bg-muted/20 px-3.5 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary min-h-[120px] resize-none leading-relaxed"
                    onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        handleSubmitAll()
                      }
                    }}
                  />
                </div>
              )}

              {/* 底部前后题切换与整卷提交条 */}
              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentIndex <= 0}
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    className="text-xs gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="size-3.5" />
                    <span>上一题</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentIndex >= questions.length - 1}
                    onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                    className="text-xs gap-1 cursor-pointer"
                  >
                    <span>下一题</span>
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    className="text-xs cursor-pointer"
                  >
                    稍后再答
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="text-xs gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs cursor-pointer"
                    onClick={handleSubmitAll}
                  >
                    <Send className="size-3.5" />
                    <span>交卷 AI 判卷</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 阶段 3：AI 判卷评分中 */}
          {phase === 'grading' && (
            <div className="py-20 flex flex-col items-center justify-center space-y-3.5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center animate-pulse">
                <Loader2 className="size-6 text-emerald-500 animate-spin" />
              </div>
              <p className="text-sm font-semibold text-foreground tracking-tight">
                AI 考官正在全面批改整份答卷（共 {questions.length} 题）...
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                对比原文逻辑基准，组织采分点命中清单、指出遗漏维度并生成精辟导师评语
              </p>
            </div>
          )}

          {/* 阶段 4：批量判卷结果复盘看板 */}
          {phase === 'result' && questions.length > 0 && (
            <div className="space-y-4">
              {/* 整卷成绩看板大横幅 */}
              <div className="flex items-center justify-between p-4 rounded-2xl border border-border/80 bg-gradient-to-r from-card via-muted/20 to-background shadow-xs">
                <div className="flex items-center gap-3.5">
                  <div
                    className={cn(
                      'w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-black text-xl border shadow-sm shrink-0',
                      overallGrade === 'A' && 'bg-emerald-500/15 text-emerald-500 border-emerald-500/35',
                      overallGrade === 'B' && 'bg-blue-500/15 text-blue-500 border-blue-500/35',
                      overallGrade === 'C' && 'bg-amber-500/15 text-amber-500 border-amber-500/35',
                      overallGrade === 'D' && 'bg-rose-500/15 text-rose-500 border-rose-500/35',
                    )}
                  >
                    {overallGrade}
                  </div>
                  <div>
                    <div className="text-lg font-bold text-foreground flex items-center gap-2">
                      <span>{totalScore} 分</span>
                      <span className="text-xs font-normal text-muted-foreground">/ 100 分 · 整卷总成绩</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 pt-0.5">
                      <span>已完成 {questions.length} 道考题深度评估</span>
                      <span className="text-emerald-500 font-medium">✓ 成绩与建议已自动落库</span>
                    </div>
                  </div>
                </div>

                {onNavigateToMark && markId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 text-primary border-primary/40 hover:bg-primary/10 shrink-0 cursor-pointer"
                    onClick={() => {
                      onOpenChange(false)
                      onNavigateToMark(markId)
                    }}
                  >
                    <BookOpen className="size-3.5" />
                    <span>查看原书证据</span>
                  </Button>
                )}
              </div>

              {/* AI 导师整卷学习诊断与总评建议卡片 */}
              <div className="p-4 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent backdrop-blur-md space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1 rounded-lg bg-primary/20 text-primary">
                      <Sparkles className="size-4" />
                    </span>
                    <span className="text-xs font-bold text-foreground tracking-tight">
                      AI 导师综合诊断与学习建议
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                    全局认知评定
                  </span>
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed font-normal whitespace-pre-wrap">
                  {overallFeedback || `整卷作答完毕，平均得分 ${totalScore} 分 (${overallGrade})。`}
                </p>
              </div>

              {/* 逐题切换导航条 */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {questions.map((q, idx) => {
                  const sub = submissions[q.id]
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setViewResultIndex(idx)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border shrink-0 cursor-pointer',
                        viewResultIndex === idx
                          ? 'bg-primary/15 text-primary border-primary/40 shadow-xs font-semibold'
                          : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60',
                      )}
                    >
                      <span>第 {idx + 1} 题</span>
                      {sub && (
                        <span className="font-mono text-[11px] font-bold">
                          {sub.score}分
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 当前题目的深度复盘卡片 */}
              {questions[viewResultIndex] && (
                <div className="space-y-3 p-4 rounded-xl border border-border/70 bg-card/60 shadow-xs">
                  <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px]">
                        {questions[viewResultIndex].tag || '考点剖析'}
                      </span>
                      <span>{questions[viewResultIndex].title}</span>
                    </div>
                    {submissions[questions[viewResultIndex].id] && (
                      <span className="font-bold text-primary font-mono text-sm">
                        得分：{submissions[questions[viewResultIndex].id].score} 分
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-medium text-foreground leading-relaxed">
                    {questions[viewResultIndex].prompt}
                  </p>

                  {/* 如果是选择题，展示选项对照 */}
                  {questions[viewResultIndex].type === 'choice' && questions[viewResultIndex].options && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[11px] font-semibold text-muted-foreground block">选项深度解析：</span>
                      <div className="grid grid-cols-1 gap-1.5">
                        {questions[viewResultIndex].options!.map((opt, oIdx) => {
                          const optLetter = opt.trim().charAt(0)
                          const userAns = userAnswers[questions[viewResultIndex].id] || ''
                          const isUserSelected =
                            userAns === opt ||
                            userAns === optLetter ||
                            userAns.startsWith(optLetter + '.')
                          const isCorrect =
                            questions[viewResultIndex].correctOption?.toUpperCase() === optLetter.toUpperCase()

                          return (
                            <div
                              key={oIdx}
                              className={cn(
                                'flex items-center justify-between p-2.5 rounded-lg border text-xs leading-relaxed',
                                isCorrect && 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-medium',
                                isUserSelected && !isCorrect && 'bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400',
                                !isUserSelected && !isCorrect && 'bg-muted/20 border-border/40 text-muted-foreground',
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold">{optLetter}.</span>
                                <span>{opt.replace(/^[A-D][.、\s]*/, '')}</span>
                              </div>
                              <div className="shrink-0 flex items-center gap-1 text-[11px]">
                                {isCorrect && <span className="text-emerald-500 font-semibold flex items-center gap-0.5"><CheckCircle2 className="size-3.5" /> 正确答案</span>}
                                {isUserSelected && !isCorrect && <span className="text-rose-500 font-semibold flex items-center gap-0.5"><XCircle className="size-3.5" /> 你的选择</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 如果是设计题，展示考核指标清单 */}
                  {questions[viewResultIndex].type === 'essay_design' &&
                    questions[viewResultIndex].designRequirements &&
                    questions[viewResultIndex].designRequirements!.length > 0 && (
                      <div className="p-3 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-1.5 text-xs">
                        <span className="font-semibold text-purple-600 dark:text-purple-400 block text-[11px] flex items-center gap-1.5">
                          <Layers className="size-3.5" />
                          <span>架构考查指标与设计维度：</span>
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {questions[viewResultIndex].designRequirements!.map((req, rIdx) => (
                            <span
                              key={rIdx}
                              className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20 text-[10px]"
                            >
                              {req}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* 读者的手写作答记录 */}
                  {questions[viewResultIndex].type !== 'choice' && (
                    <div className="p-3 rounded-lg bg-muted/30 text-xs text-foreground/90 border border-border/40 space-y-1">
                      <span className="text-muted-foreground text-[10px] block font-semibold">你的阐述：</span>
                      <p className="leading-relaxed">{userAnswers[questions[viewResultIndex].id] || '（未作答）'}</p>
                    </div>
                  )}

                  {/* 采分点比对清单 */}
                  {submissions[questions[viewResultIndex].id] && (
                    <div className="space-y-1.5 pt-1 text-xs">
                      <div className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                        <Trophy className="size-3.5 text-amber-500" />
                        <span>采分要点比对：</span>
                      </div>
                      {submissions[questions[viewResultIndex].id].hitKeyPoints.map((kp, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-emerald-500 text-[11px]">
                          <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
                          <span className="text-foreground/90">{kp}（论点已击中）</span>
                        </div>
                      ))}
                      {submissions[questions[viewResultIndex].id].missedKeyPoints.map((kp, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-amber-500 text-[11px]">
                          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                          <span className="text-muted-foreground">{kp}（核心依据，建议加深）</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 导师精辟点评 */}
                  {submissions[questions[viewResultIndex].id] && (
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 text-[11px] space-y-1">
                      <span className="font-semibold text-primary block flex items-center gap-1">
                        <Sparkles className="size-3" />
                        <span>导师考官点评：</span>
                      </span>
                      <p className="text-foreground/80 leading-relaxed">
                        {submissions[questions[viewResultIndex].id].feedback}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 底部重答与完成控制条 */}
              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1 cursor-pointer"
                  onClick={() => setPhase('answering')}
                >
                  <RotateCcw className="size-3.5" />
                  <span>重新作答</span>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="text-xs px-5 cursor-pointer font-semibold"
                  onClick={() => onOpenChange(false)}
                >
                  完成复盘
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
