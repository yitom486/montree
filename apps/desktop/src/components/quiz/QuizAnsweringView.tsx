import React from 'react'
import { Button } from '@/components/ui/button'
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Check,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizQuestion } from '@montree/contracts'

export interface QuizAnsweringViewProps {
  questions: QuizQuestion[]
  currentIndex: number
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>
  currentQuestion: QuizQuestion
  currentAnswer: string
  userAnswers: Record<string, string>
  showExcerptPanel: boolean
  setShowExcerptPanel: React.Dispatch<React.SetStateAction<boolean>>
  onSelectOption: (opt: string) => void
  onAnswerChange: (val: string) => void
  onSubmitAll: () => void
  onCloseDialog: () => void
}

export function QuizAnsweringView({
  questions,
  currentIndex,
  setCurrentIndex,
  currentQuestion,
  currentAnswer,
  userAnswers,
  showExcerptPanel,
  setShowExcerptPanel,
  onSelectOption,
  onAnswerChange,
  onSubmitAll,
  onCloseDialog,
}: QuizAnsweringViewProps) {
  return (
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
                  onClick={() => onSelectOption(opt)}
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
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onAnswerChange(e.target.value)}
            placeholder="阐明你的推导依据、论证逻辑或反思（按 Ctrl+Enter 快捷提交整卷判卷）..."
            className="w-full rounded-xl border border-input bg-muted/20 px-3.5 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary min-h-[120px] resize-none leading-relaxed"
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                onSubmitAll()
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
            onClick={onCloseDialog}
            className="text-xs cursor-pointer"
          >
            稍后再答
          </Button>
          <Button
            variant="default"
            size="sm"
            className="text-xs gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs cursor-pointer"
            onClick={onSubmitAll}
          >
            <Send className="size-3.5" />
            <span>交卷 AI 判卷</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
