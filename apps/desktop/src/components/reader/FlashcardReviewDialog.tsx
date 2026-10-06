import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Flashcard } from '@montree/annotations'
import {
  calculateReviewStats,
  parseClozeContent,
  type FlashcardReviewRating,
} from '@montree/annotations'
import {
  BookOpen,
  RotateCcw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Trophy,
} from 'lucide-react'

export interface FlashcardReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cards: Flashcard[]
  bookTitle: string
  onNavigateToMark?: (markId: string) => void
  /** 评分落盘（UI批）：调用方持久化，失败不打断复习流（本地评分态照常推进） */
  onRate?: (cardId: string, rating: FlashcardReviewRating) => void
}

export function FlashcardReviewDialog({
  open,
  onOpenChange,
  cards,
  bookTitle,
  onNavigateToMark,
  onRate,
}: FlashcardReviewDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [ratings, setRatings] = useState<Record<string, FlashcardReviewRating>>({})
  const [isFinished, setIsFinished] = useState(false)

  // 每次打开或卡片改变时重置状态
  useEffect(() => {
    if (open) {
      setCurrentIndex(0)
      setIsFlipped(false)
      setRatings({})
      setIsFinished(false)
    }
  }, [open, cards])

  const totalCards = cards.length
  const currentCard = cards[currentIndex]

  // 下一张 / 结算
  const handleNext = useCallback(() => {
    setIsFlipped(false)
    if (currentIndex < totalCards - 1) {
      setCurrentIndex((i) => i + 1)
    } else {
      setIsFinished(true)
    }
  }, [currentIndex, totalCards])

  // 上一张
  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setIsFlipped(false)
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  // 记忆评级打分
  const handleRate = useCallback(
    (rating: FlashcardReviewRating) => {
      if (!currentCard) return
      setRatings((prev) => ({ ...prev, [currentCard.id]: rating }))
      onRate?.(currentCard.id, rating)
      handleNext()
    },
    [currentCard, handleNext, onRate],
  )

  // 全键盘快捷键调度（空格翻转、数字键打分、左右键切卡）
  useEffect(() => {
    if (!open || isFinished || !currentCard) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免输入框内误触
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        setIsFlipped((f) => !f)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        handlePrev()
      } else if (isFlipped) {
        if (e.key === '1') {
          e.preventDefault()
          handleRate('again')
        } else if (e.key === '2') {
          e.preventDefault()
          handleRate('hard')
        } else if (e.key === '3') {
          e.preventDefault()
          handleRate('good')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, isFinished, currentCard, isFlipped, handleNext, handlePrev, handleRate])

  // 卡片正反面解析
  const parsedCloze = useMemo(() => {
    if (currentCard?.kind === 'cloze') {
      return parseClozeContent(currentCard.front)
    }
    return null
  }, [currentCard])

  // 统计结果
  const stats = useMemo(
    () => calculateReviewStats(ratings, totalCards),
    [ratings, totalCards],
  )

  if (!totalCards) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              闪卡复习
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center text-sm text-muted-foreground">
            当前章节或全书中暂无重点高亮或批注。在阅读时划选文本，即可自动转化为闪卡！
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const progressPercent = Math.round(((currentIndex + 1) / totalCards) * 100)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-card/95 backdrop-blur-xl border-border/80 shadow-2xl p-6 select-none">
        {/* 顶部标题与进度栏 */}
        <DialogHeader className="gap-1.5 pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Sparkles className="size-4 text-primary" />
              闪卡复习 · 《{bookTitle}》
            </DialogTitle>
            <span className="text-xs font-mono font-medium text-muted-foreground">
              {currentIndex + 1} / {totalCards}
            </span>
          </div>
          <DialogDescription className="sr-only">
            Montree 沉浸式闪卡抽认复习模式
          </DialogDescription>
          {/* 进度条 */}
          <div className="w-full h-1.5 bg-secondary/80 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </DialogHeader>

        {isFinished ? (
          /* 复习总结结算视图 */
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-5 animate-in fade-in-50 zoom-in-95 duration-200">
            <div className="size-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-lg">
              <Trophy className="size-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">
                🎉 本轮复习全部完成！
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                熟读精思，学而不怠。共完成 {totalCards} 张闪卡抽认。
              </p>
            </div>

            {/* 评分分布看板 */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
              <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-center">
                <div className="text-xl font-bold text-emerald-500">
                  {stats.counts.good}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  熟练掌握
                </div>
              </div>
              <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-center">
                <div className="text-xl font-bold text-amber-500">
                  {stats.counts.hard}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  需再巩固
                </div>
              </div>
              <div className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/5 text-center">
                <div className="text-xl font-bold text-rose-500">
                  {stats.counts.again}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  遗忘重读
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  setCurrentIndex(0)
                  setIsFlipped(false)
                  setRatings({})
                  setIsFinished(false)
                }}
              >
                <RotateCcw className="size-3.5" />
                重新复习一遍
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
        ) : (
          /* 3D 翻转卡片与交互操作区 */
          <div className="flex flex-col space-y-4">
            {/* 3D 卡片核心容器 */}
            <div
              className="relative w-full h-[280px] cursor-pointer [perspective:1200px]"
              onClick={() => setIsFlipped((prev) => !prev)}
            >
              <div
                className={cn(
                  'relative w-full h-full rounded-xl transition-transform duration-500 [transform-style:preserve-3d]',
                  isFlipped && '[transform:rotateY(180deg)]',
                )}
              >
                {/* 卡片正面 (Front) */}
                <div className="absolute inset-0 w-full h-full rounded-xl border border-border/80 bg-gradient-to-b from-card to-card/90 p-6 shadow-xl backdrop-blur-md flex flex-col justify-between [backface-visibility:hidden]">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2.5">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {currentCard?.kind === 'cloze' ? (
                        parsedCloze?.isEntirelyMasked ? (
                          <span className="inline-flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[11px]">
                            <BookOpen className="size-3" />
                            重点摘录 (Excerpt)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-primary bg-primary/10 px-2 py-0.5 rounded-full text-[11px]">
                            <HelpCircle className="size-3" />
                            填空题 (Cloze)
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full text-[11px]">
                          <AlertCircle className="size-3" />
                          思考问答 (Q&A)
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] truncate max-w-[200px]">
                      {currentCard?.chapterName || '书本划线'}
                    </span>
                  </div>

                  {/* 正面主文本 */}
                  <div className="flex-1 flex items-center justify-center py-4 text-center px-4 overflow-y-auto">
                    {currentCard?.kind === 'cloze' && parsedCloze ? (
                      parsedCloze.isEntirelyMasked ? (
                        <div className="space-y-3 max-w-lg">
                          <div className="inline-flex items-center gap-1.5 text-xs text-primary bg-primary/10 px-2.5 py-1 rounded-full font-medium">
                            <Sparkles className="size-3.5" />
                            原书划线 · 记忆回想
                          </div>
                          <p className="text-xs text-muted-foreground">
                            请尝试回忆原书本段的核心论点与论述主旨：
                          </p>
                          <div className="text-sm font-medium text-foreground/90 italic bg-muted/40 px-4 py-3 rounded-lg border border-border/60 text-center leading-relaxed">
                            “{parsedCloze.clue}”
                          </div>
                        </div>
                      ) : (
                        <p className="text-base font-normal leading-relaxed text-foreground/90">
                          {parsedCloze.frontText}
                        </p>
                      )
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                          批注与提问
                        </p>
                        <p className="text-base font-medium leading-relaxed text-foreground">
                          {currentCard?.front}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 底部翻转提示 */}
                  <div className="text-center text-[11px] text-muted-foreground/70 border-t border-border/30 pt-2 flex items-center justify-center gap-1">
                    <span>点击卡片或敲击</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted border border-border rounded">
                      Space
                    </kbd>
                    <span>翻转查看答案与原文</span>
                  </div>
                </div>

                {/* 卡片背面 (Back) */}
                <div className="absolute inset-0 w-full h-full rounded-xl border border-border/80 bg-gradient-to-b from-card to-card/90 p-6 shadow-xl backdrop-blur-md flex flex-col justify-between [transform:rotateY(180deg)] [backface-visibility:hidden]">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2.5">
                    <span className="flex items-center gap-1 font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[11px]">
                      <CheckCircle2 className="size-3" />
                      答案与出处
                    </span>
                    {/* 杀手级特性：一键秒回原书原位 */}
                    {onNavigateToMark ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[11px] gap-1 px-2 border-primary/40 text-primary hover:bg-primary/10 hover:border-primary"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenChange(false)
                          onNavigateToMark(currentCard.id)
                        }}
                        title="在阅读器中精确定位并闪烁该段文字"
                      >
                        <BookOpen className="size-3" />
                        回到原书原位
                      </Button>
                    ) : null}
                  </div>

                  {/* 背面主内容 */}
                  <div className="flex-1 flex flex-col justify-center py-3 px-3 overflow-y-auto space-y-3 text-left">
                    {currentCard?.kind === 'cloze' && parsedCloze ? (
                      parsedCloze.isEntirelyMasked ? (
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            原书重点完整文段
                          </p>
                          <blockquote className="border-l-2 border-emerald-500/70 pl-3 py-1.5 text-sm text-foreground leading-relaxed bg-emerald-500/5 rounded-r">
                            {parsedCloze.answers[0]}
                          </blockquote>
                        </div>
                      ) : (
                        <div
                          className="text-sm leading-relaxed text-foreground/90"
                          dangerouslySetInnerHTML={{ __html: parsedCloze.backHtml }}
                        />
                      )
                    ) : (
                      <blockquote className="border-l-2 border-primary/50 pl-3 py-0.5 text-xs text-muted-foreground italic leading-relaxed bg-muted/20 rounded-r">
                        {currentCard?.back}
                      </blockquote>
                    )}
                    <div className="text-[11px] text-muted-foreground/80 font-mono">
                      —— 出处：{currentCard?.sourceTitle}
                      {currentCard?.chapterName ? ` · ${currentCard.chapterName}` : ''}
                    </div>
                  </div>

                  {/* 背面打分提示 */}
                  <div className="text-center text-[11px] text-muted-foreground/70 border-t border-border/30 pt-2">
                    通过下方按钮或键盘数字键
                    <kbd className="px-1 py-0.5 mx-1 text-[10px] font-mono bg-muted border border-border rounded">
                      1
                    </kbd>
                    <kbd className="px-1 py-0.5 mr-1 text-[10px] font-mono bg-muted border border-border rounded">
                      2
                    </kbd>
                    <kbd className="px-1 py-0.5 mr-1 text-[10px] font-mono bg-muted border border-border rounded">
                      3
                    </kbd>
                    评定熟练度并进入下一张
                  </div>
                </div>
              </div>
            </div>

            {/* 底部评级与翻卡操作栏 */}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 h-8"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="size-3.5" />
                上一张
              </Button>

              {/* 当未翻面时：展示翻转按钮；翻面后：展示记忆打分项 */}
              {!isFlipped ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 px-4 font-medium"
                  onClick={() => setIsFlipped(true)}
                >
                  <RotateCcw className="size-3.5" />
                  翻转卡片 (Space)
                </Button>
              ) : (
                <div className="flex items-center gap-2 animate-in fade-in-50 duration-150">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-3 border-rose-500/30 text-rose-500 hover:bg-rose-500/10 hover:border-rose-500"
                    onClick={() => handleRate('again')}
                  >
                    <span className="font-mono text-[10px] mr-1 opacity-70">[1]</span>
                    忘记 (Again)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-3 border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:border-amber-500"
                    onClick={() => handleRate('hard')}
                  >
                    <span className="font-mono text-[10px] mr-1 opacity-70">[2]</span>
                    模糊 (Hard)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-3 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 hover:border-emerald-500 font-medium"
                    onClick={() => handleRate('good')}
                  >
                    <span className="font-mono text-[10px] mr-1 opacity-70">[3]</span>
                    熟练 (Good)
                  </Button>
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1 h-8"
                onClick={handleNext}
              >
                下一张
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
