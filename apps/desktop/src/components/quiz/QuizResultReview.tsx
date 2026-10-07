import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Sparkles,
  BookOpen,
  CheckCircle2,
  Trophy,
  RotateCcw,
  AlertCircle,
  XCircle,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  QuizAnswerSubmission,
  QuizGrade,
  QuizQuestion,
} from '@montree/contracts'

export interface QuizResultReviewProps {
  questions: QuizQuestion[]
  submissions: Record<string, QuizAnswerSubmission>
  userAnswers: Record<string, string>
  totalScore: number
  overallGrade: QuizGrade
  overallFeedback: string
  viewResultIndex: number
  setViewResultIndex: (idx: number) => void
  markId?: string
  onNavigateToMark?: (markId: string) => void
  onCloseDialog: () => void
  onReanswer: () => void
}

export function QuizResultReview({
  questions,
  submissions,
  userAnswers,
  totalScore,
  overallGrade,
  overallFeedback,
  viewResultIndex,
  setViewResultIndex,
  markId,
  onNavigateToMark,
  onCloseDialog,
  onReanswer,
}: QuizResultReviewProps) {
  const currentQ = questions[viewResultIndex]
  const currentSub = currentQ ? submissions[currentQ.id] : undefined

  return (
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
              onCloseDialog()
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
      {currentQ && (
        <div className="space-y-3 p-4 rounded-xl border border-border/70 bg-card/60 shadow-xs">
          <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2">
            <div className="font-semibold text-foreground flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px]">
                {currentQ.tag || '考点剖析'}
              </span>
              <span>{currentQ.title}</span>
            </div>
            {currentSub && (
              <span className="font-bold text-primary font-mono text-sm">
                得分：{currentSub.score} 分
              </span>
            )}
          </div>

          <p className="text-xs font-medium text-foreground leading-relaxed">
            {currentQ.prompt}
          </p>

          {/* 如果是选择题，展示选项对照 */}
          {currentQ.type === 'choice' && currentQ.options && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-semibold text-muted-foreground block">选项深度解析：</span>
              <div className="grid grid-cols-1 gap-1.5">
                {currentQ.options.map((opt, oIdx) => {
                  const optLetter = opt.trim().charAt(0)
                  const userAns = userAnswers[currentQ.id] || ''
                  const isUserSelected =
                    userAns === opt ||
                    userAns === optLetter ||
                    userAns.startsWith(optLetter + '.')
                  const isCorrect =
                    currentQ.correctOption?.toUpperCase() === optLetter.toUpperCase()

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
                        {isCorrect && (
                          <span className="text-emerald-500 font-semibold flex items-center gap-0.5">
                            <CheckCircle2 className="size-3.5" /> 正确答案
                          </span>
                        )}
                        {isUserSelected && !isCorrect && (
                          <span className="text-rose-500 font-semibold flex items-center gap-0.5">
                            <XCircle className="size-3.5" /> 你的选择
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 如果是设计题，展示考核指标清单 */}
          {currentQ.type === 'essay_design' &&
            currentQ.designRequirements &&
            currentQ.designRequirements.length > 0 && (
              <div className="p-3 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-1.5 text-xs">
                <span className="font-semibold text-purple-600 dark:text-purple-400 block text-[11px] flex items-center gap-1.5">
                  <Layers className="size-3.5" />
                  <span>架构考查指标与设计维度：</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentQ.designRequirements.map((req, rIdx) => (
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
          {currentQ.type !== 'choice' && (
            <div className="p-3 rounded-lg bg-muted/30 text-xs text-foreground/90 border border-border/40 space-y-1">
              <span className="text-muted-foreground text-[10px] block font-semibold">你的阐述：</span>
              <p className="leading-relaxed">{userAnswers[currentQ.id] || '（未作答）'}</p>
            </div>
          )}

          {/* 采分点比对清单 */}
          {currentSub && (
            <div className="space-y-1.5 pt-1 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                <Trophy className="size-3.5 text-amber-500" />
                <span>采分要点比对：</span>
              </div>
              {currentSub.hitKeyPoints.map((kp, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-emerald-500 text-[11px]">
                  <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
                  <span className="text-foreground/90">{kp}（论点已击中）</span>
                </div>
              ))}
              {currentSub.missedKeyPoints.map((kp, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-amber-500 text-[11px]">
                  <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{kp}（核心依据，建议加深）</span>
                </div>
              ))}
            </div>
          )}

          {/* 导师精辟点评 */}
          {currentSub && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/15 text-[11px] space-y-1">
              <span className="font-semibold text-primary block flex items-center gap-1">
                <Sparkles className="size-3" />
                <span>导师考官点评：</span>
              </span>
              <p className="text-foreground/80 leading-relaxed">
                {currentSub.feedback}
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
          onClick={onReanswer}
        >
          <RotateCcw className="size-3.5" />
          <span>重新作答</span>
        </Button>
        <Button
          variant="default"
          size="sm"
          className="text-xs px-5 cursor-pointer font-semibold"
          onClick={onCloseDialog}
        >
          完成复盘
        </Button>
      </div>
    </div>
  )
}
