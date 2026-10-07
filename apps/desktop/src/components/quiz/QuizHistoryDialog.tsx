import React, { useState, useEffect } from 'react'
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
  History,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Trophy,
  Calendar,
  Layers,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useQuizSessions } from '@/hooks/quiz/useQuizSessions'

export interface QuizHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookTitle: string
  filePath: string
  onNavigateToMark?: (markId: string) => void
  onRetryQuestion?: (passage: string, chapterTitle?: string, markId?: string) => void
}

export function QuizHistoryDialog({
  open,
  onOpenChange,
  bookTitle,
  filePath,
  onNavigateToMark,
  onRetryQuestion,
}: QuizHistoryDialogProps) {
  const { sessions, isLoading: loading } = useQuizSessions(filePath, open)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (sessions.length > 0) {
      setSelectedId((prev) => (sessions.some((s) => s.id === prev) ? prev : sessions[0].id))
    } else {
      setSelectedId(null)
    }
  }, [open, sessions])

  const [activeQuestionIdx, setActiveQuestionIdx] = useState<number>(0)

  const currentSession = sessions.find((s) => s.id === selectedId)
  const activeQuestion = currentSession?.questions[activeQuestionIdx] || currentSession?.questions[0]
  const submission = activeQuestion ? currentSession?.submissions[activeQuestion.id] : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl bg-card/95 backdrop-blur-xl border border-border/80 shadow-2xl overflow-hidden p-6 max-h-[85vh] flex flex-col"
        aria-describedby="quiz-history-dialog-desc"
      >
        <DialogHeader className="border-b border-border/40 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <History className="size-4" />
            </span>
            <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
              答题历史与成绩回放
            </DialogTitle>
          </div>
          <DialogDescription id="quiz-history-dialog-desc" className="text-xs text-muted-foreground line-clamp-1">
            《{bookTitle}》· 共 {sessions.length} 次测验记录（本地知识库）
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-xs text-muted-foreground">
            正在读取答题流式记录...
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-2 text-center">
            <Layers className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground/80">暂无测验记录</p>
            <p className="text-xs text-muted-foreground">
              在右侧批注栏选中任意段落，点击「🎯 AI 考考我」开始首次挑战吧！
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0 pt-2 overflow-hidden">
            {/* 左侧测验历史列表 */}
            <div className="md:col-span-1 border-r border-border/40 pr-3 overflow-y-auto space-y-2">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                测验轮次
              </div>
              {sessions.map((sess) => {
                const q = sess.questions[0]
                const isSelected = sess.id === selectedId
                const dateStr = new Date(sess.createdAt).toLocaleDateString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <button
                    key={sess.id}
                    onClick={() => {
                      setSelectedId(sess.id)
                      setActiveQuestionIdx(0)
                    }}
                    className={cn(
                      'w-full text-left p-2.5 rounded-lg border transition-all flex flex-col gap-1',
                      isSelected
                        ? 'border-primary/50 bg-primary/10 shadow-sm'
                        : 'border-border/40 bg-muted/20 hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground truncate max-w-[120px]">
                        {sess.questions.length > 1 ? `试卷 (${sess.questions.length}题)` : q?.title || '深度思考测验'}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded',
                          sess.grade === 'A' && 'bg-emerald-500/20 text-emerald-500',
                          sess.grade === 'B' && 'bg-blue-500/20 text-blue-500',
                          sess.grade === 'C' && 'bg-amber-500/20 text-amber-500',
                          sess.grade === 'D' && 'bg-rose-500/20 text-rose-500',
                        )}
                      >
                        {sess.totalScore}分 · {sess.grade}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Calendar className="size-3" />
                      <span>{dateStr}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 右侧测验详情完整回放 (Replay) */}
            <div className="md:col-span-2 overflow-y-auto pl-1 pr-1 space-y-3 text-xs">
              {currentSession && activeQuestion && submission ? (
                <>
                  {/* 分数条 */}
                  <div className="p-3 rounded-xl border border-border/80 bg-muted/30 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="text-base font-bold text-foreground">
                        整卷得分：<span className="text-primary text-lg">{currentSession.totalScore}</span> / 100
                      </div>
                      <span
                        className={cn(
                          'text-[11px] font-bold px-2 py-0.5 rounded-full',
                          currentSession.grade === 'A' && 'bg-emerald-500/20 text-emerald-500',
                          currentSession.grade === 'B' && 'bg-blue-500/20 text-blue-500',
                          currentSession.grade === 'C' && 'bg-amber-500/20 text-amber-500',
                          currentSession.grade === 'D' && 'bg-rose-500/20 text-rose-500',
                        )}
                      >
                        等级 {currentSession.grade}
                      </span>
                    </div>

                    {onNavigateToMark && activeQuestion.markId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 text-primary border-primary/40"
                        onClick={() => {
                          onOpenChange(false)
                          onNavigateToMark(activeQuestion.markId!)
                        }}
                      >
                        <BookOpen className="size-3" />
                        📖 查看原书
                      </Button>
                    ) : null}
                  </div>

                  {/* AI 整卷综合诊断与复习建议 */}
                  {currentSession.overallFeedback && (
                    <div className="p-3 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent space-y-1.5 shadow-xs">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Sparkles className="size-3.5" />
                        <span>AI 导师综合诊断与学习建议</span>
                      </div>
                      <p className="text-[11px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                        {currentSession.overallFeedback}
                      </p>
                    </div>
                  )}

                  {/* 多题题卡切换 */}
                  {currentSession.questions.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      {currentSession.questions.map((q, idx) => {
                        const sub = currentSession.submissions[q.id]
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => setActiveQuestionIdx(idx)}
                            className={cn(
                              'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors shrink-0 flex items-center gap-1',
                              activeQuestionIdx === idx
                                ? 'bg-primary/10 text-primary border-primary/40'
                                : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60',
                            )}
                          >
                            <span>第 {idx + 1} 题</span>
                            {sub ? <span className="font-mono font-bold">({sub.score}分)</span> : null}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* 题目 */}
                  <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-1">
                    <div className="font-semibold text-primary flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="size-3.5" />
                        <span>考题：{activeQuestion.title}</span>
                      </div>
                      {activeQuestion.tag ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {activeQuestion.tag}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-foreground/90 font-medium leading-relaxed">
                      {activeQuestion.prompt}
                    </p>
                  </div>

                  {/* 设计题考查维度清单 */}
                  {activeQuestion.type === 'essay_design' &&
                    activeQuestion.designRequirements &&
                    activeQuestion.designRequirements.length > 0 && (
                      <div className="p-2.5 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-1 text-xs">
                        <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                          <Layers className="size-3" />
                          <span>架构考查指标与设计维度：</span>
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {activeQuestion.designRequirements.map((req, rIdx) => (
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

                  {/* 选择题选项回放对照 */}
                  {activeQuestion.type === 'choice' && activeQuestion.options && (
                    <div className="space-y-1.5">
                      <div className="text-muted-foreground font-medium text-[11px]">选项复盘与原书解析：</div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {activeQuestion.options.map((opt, oIdx) => {
                          const optLetter = opt.trim().charAt(0)
                          const userAns = submission.userAnswer || ''
                          const isUserSelected =
                            userAns === opt ||
                            userAns === optLetter ||
                            userAns.startsWith(optLetter + '.')
                          const isCorrect =
                            activeQuestion.correctOption?.toUpperCase() === optLetter.toUpperCase()

                          return (
                            <div
                              key={oIdx}
                              className={cn(
                                'flex items-center justify-between p-2 rounded-lg border text-xs leading-relaxed',
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
                                {isCorrect && <span className="text-emerald-500 font-semibold flex items-center gap-0.5"><CheckCircle2 className="size-3.5" /> 正确项</span>}
                                {isUserSelected && !isCorrect && <span className="text-rose-500 font-semibold flex items-center gap-0.5"><XCircle className="size-3.5" /> 你的回答</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {activeQuestion.explanation && (
                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 text-[11px] text-foreground/80 leading-relaxed">
                          <span className="font-semibold text-primary">原书依据解析：</span>
                          {activeQuestion.explanation}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 读者手写作答 */}
                  {activeQuestion.type !== 'choice' && (
                    <div className="space-y-1">
                      <div className="text-muted-foreground font-medium">你的原始回答：</div>
                      <div className="p-3 rounded-lg bg-muted/30 border border-border/60 text-foreground/90 leading-relaxed italic">
                        “{submission.userAnswer}”
                      </div>
                    </div>
                  )}

                  {/* 采分点对比 */}
                  <div className="p-3 rounded-lg border border-border/60 bg-card/60 space-y-2">
                    <div className="font-semibold text-foreground flex items-center gap-1">
                      <Trophy className="size-3.5 text-amber-500" />
                      采分点比对：
                    </div>
                    <div className="space-y-1 text-[11px]">
                      {submission.hitKeyPoints.map((kp, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-emerald-500">
                          <CheckCircle2 className="size-3 shrink-0" />
                          <span>{kp}（已命中）</span>
                        </div>
                      ))}
                      {submission.missedKeyPoints.map((kp, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-amber-500">
                          <AlertCircle className="size-3 shrink-0" />
                          <span className="text-muted-foreground">{kp}（未答出）</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 导师评语 */}
                  <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-1 text-foreground/90 leading-relaxed">
                    <span className="font-semibold text-primary">导师评语：</span>
                    {submission.feedback}
                  </div>

                  {/* 底部重测按钮 */}
                  {onRetryQuestion && (
                    <div className="pt-2 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={() => {
                          onOpenChange(false)
                          onRetryQuestion(
                            activeQuestion.sourceExcerpt,
                            activeQuestion.chapterTitle,
                            activeQuestion.markId,
                          )
                        }}
                      >
                        重新挑战这道题
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-20 text-center text-muted-foreground">
                  请在左侧选择一次测验进行回放
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
