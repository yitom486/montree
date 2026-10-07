import React, { useState } from 'react'
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
  RotateCcw,
  History,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useQuizSessionState } from '@/components/quiz/useQuizSessionState'
import { QuizConfigPanel, QuizConfigDrawer } from '@/components/quiz/QuizConfigPanel'
import { QuizAnsweringView } from '@/components/quiz/QuizAnsweringView'
import { QuizResultReview } from '@/components/quiz/QuizResultReview'

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
  const [isMaximized, setIsMaximized] = useState(false)

  const {
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
  } = useQuizSessionState({
    open,
    passage,
    bookTitle,
    filePath,
    chapterTitle,
    markId,
  })

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
                onClick={resetSessionAndReload}
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
          <QuizConfigDrawer
            enabledTypes={enabledTypes}
            toggleQuestionType={toggleQuestionType}
            focusOnCards={focusOnCards}
            setFocusOnCards={setFocusOnCards}
            includeContext={includeContext}
            setIncludeContext={setIncludeContext}
            targetCount={targetCount}
            onRecreateQuiz={() => {
              loadQuestions(targetCount, {
                totalCount: targetCount,
                enabledTypes,
                focusOnCards,
                includeContext,
              })
            }}
          />
        )}

        {/* 主内容区域 */}
        <div className="flex-1 overflow-y-auto py-2 px-0.5 space-y-4">
          {/* 阶段 0：试卷个性化定制与历史向导准备台 */}
          {phase === 'config' && (
            <QuizConfigPanel
              bookTitle={bookTitle}
              chapterTitle={chapterTitle}
              passage={passage}
              targetCount={targetCount}
              setTargetCount={setTargetCount}
              enabledTypes={enabledTypes}
              toggleQuestionType={toggleQuestionType}
              focusOnCards={focusOnCards}
              setFocusOnCards={setFocusOnCards}
              includeContext={includeContext}
              setIncludeContext={setIncludeContext}
              showExcerptPanel={showExcerptPanel}
              setShowExcerptPanel={setShowExcerptPanel}
              onOpenHistory={onOpenHistory}
              onCloseDialog={() => onOpenChange(false)}
              onStartQuiz={(cnt, cfg) => loadQuestions(cnt, cfg)}
            />
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

          {/* 阶段 2：交互作答界面 */}
          {phase === 'answering' && currentQuestion && (
            <QuizAnsweringView
              questions={questions}
              currentIndex={currentIndex}
              setCurrentIndex={setCurrentIndex}
              currentQuestion={currentQuestion}
              currentAnswer={currentAnswer}
              userAnswers={userAnswers}
              showExcerptPanel={showExcerptPanel}
              setShowExcerptPanel={setShowExcerptPanel}
              onSelectOption={handleSelectOption}
              onAnswerChange={handleAnswerChange}
              onSubmitAll={handleSubmitAll}
              onCloseDialog={() => onOpenChange(false)}
            />
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
            <QuizResultReview
              questions={questions}
              submissions={submissions}
              userAnswers={userAnswers}
              totalScore={totalScore}
              overallGrade={overallGrade}
              overallFeedback={overallFeedback}
              viewResultIndex={viewResultIndex}
              setViewResultIndex={setViewResultIndex}
              markId={markId}
              onNavigateToMark={onNavigateToMark}
              onCloseDialog={() => onOpenChange(false)}
              onReanswer={() => setPhase('answering')}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
