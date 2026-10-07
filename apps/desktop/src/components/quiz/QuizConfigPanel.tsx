import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Sparkles,
  BookOpen,
  History,
  Layers,
  SlidersHorizontal,
  Settings2,
  CheckSquare,
  Square,
  GraduationCap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizConfig, QuizQuestionType } from '@montree/contracts'
import { toast } from 'sonner'

export interface QuizConfigPanelProps {
  bookTitle: string
  chapterTitle?: string
  passage: string
  targetCount: number
  setTargetCount: (count: number) => void
  enabledTypes: QuizQuestionType[]
  toggleQuestionType: (type: QuizQuestionType) => void
  focusOnCards: boolean
  setFocusOnCards: React.Dispatch<React.SetStateAction<boolean>>
  includeContext: boolean
  setIncludeContext: React.Dispatch<React.SetStateAction<boolean>>
  showExcerptPanel: boolean
  setShowExcerptPanel: React.Dispatch<React.SetStateAction<boolean>>
  onOpenHistory?: () => void
  onCloseDialog: () => void
  onStartQuiz: (count: number, config?: QuizConfig) => void
}

export function QuizConfigPanel({
  bookTitle,
  chapterTitle,
  passage,
  targetCount,
  setTargetCount,
  enabledTypes,
  toggleQuestionType,
  focusOnCards,
  setFocusOnCards,
  includeContext,
  setIncludeContext,
  showExcerptPanel,
  setShowExcerptPanel,
  onOpenHistory,
  onCloseDialog,
  onStartQuiz,
}: QuizConfigPanelProps) {
  return (
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
              onCloseDialog()
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
                    {checked ? (
                      <CheckSquare className="size-3.5 text-primary" />
                    ) : (
                      <Square className="size-3.5 text-muted-foreground/60" />
                    )}
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
            onStartQuiz(3, {
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
            onStartQuiz(targetCount)
          }}
        >
          <GraduationCap className="size-4" />
          <span>开始定制出卷 ({targetCount}题)</span>
        </Button>
      </div>
    </div>
  )
}

export interface QuizConfigDrawerProps {
  enabledTypes: QuizQuestionType[]
  toggleQuestionType: (type: QuizQuestionType) => void
  focusOnCards: boolean
  setFocusOnCards: React.Dispatch<React.SetStateAction<boolean>>
  includeContext: boolean
  setIncludeContext: React.Dispatch<React.SetStateAction<boolean>>
  targetCount: number
  onRecreateQuiz: () => void
}

export function QuizConfigDrawer({
  enabledTypes,
  toggleQuestionType,
  focusOnCards,
  setFocusOnCards,
  includeContext,
  setIncludeContext,
  targetCount,
  onRecreateQuiz,
}: QuizConfigDrawerProps) {
  return (
    <div className="border-b border-border/60 bg-muted/20 p-3 rounded-lg mx-0.5 space-y-2.5 text-xs animate-in fade-in-50 duration-200">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <Settings2 className="size-3.5 text-primary" />
          <span>试卷结构与考察偏好配置</span>
        </span>
        <span className="text-[11px]">按勾选项即时生效定制</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

        <div className="p-2 rounded-md bg-background/80 border border-border/60 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground block">当前题量规划：</span>
            <span className="text-xs font-bold text-foreground mt-0.5 block">{targetCount} 道系统考题</span>
          </div>
          <Button
            size="sm"
            className="w-full text-xs h-7 gap-1.5 font-semibold cursor-pointer mt-2"
            onClick={() => {
              onRecreateQuiz()
              toast.success('已应用试卷定制配置，正在重新出题...')
            }}
          >
            <Sparkles className="size-3.5" />
            <span>按此配置重新出卷</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
