import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as fflate from 'fflate'
import { fileApi } from '@/api/file-api'
import { isOk } from '@montree/contracts'
import { Button } from '@/components/ui/button'
import {
  Presentation,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RefreshCw,
  AlertCircle,
  Loader2,
  Play,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  LayoutList,
  Columns,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SlideParagraph {
  text: string
  fontSize?: number
  isBold?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
}

interface SlideShape {
  id: string
  x: number // 百分比 0-100
  y: number // 百分比 0-100
  w: number // 百分比 0-100
  h: number // 百分比 0-100
  bgColor?: string
  paragraphs: SlideParagraph[]
}

interface SlideImage {
  id: string
  x: number
  y: number
  w: number
  h: number
  src: string
}

interface ParsedSlide {
  index: number
  title: string
  shapes: SlideShape[]
  images: SlideImage[]
  plainText: string[]
}

interface PptxViewerProps {
  filePath: string
  className?: string
}

export function PptxViewer({ filePath, className }: PptxViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slides, setSlides] = useState<ParsedSlide[]>([])
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [viewMode, setViewMode] = useState<'deck' | 'single'>('deck')
  const [showOutline, setShowOutline] = useState(true)
  const [isSlideShow, setIsSlideShow] = useState(false)
  const [copied, setCopied] = useState(false)

  const slideRefs = useRef<(HTMLDivElement | null)[]>([])

  const loadAndParsePptx = useCallback(async () => {
    if (!filePath) return
    setLoading(true)
    setError(null)

    try {
      const res = await fileApi.readBinaryFile(filePath)
      if (!isOk(res)) {
        setError(res.error.message || '无法读取 PPTX 文件')
        setLoading(false)
        return
      }

      const unzipped = fflate.unzipSync(new Uint8Array(res.value.data.buffer))

      // 提取幻灯片尺寸
      let slideW = 12192000
      let slideH = 6858000
      if (unzipped['ppt/presentation.xml']) {
        const presXml = fflate.strFromU8(unzipped['ppt/presentation.xml'])
        const szMatch = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
        if (szMatch) {
          slideW = parseInt(szMatch[1], 10)
          slideH = parseInt(szMatch[2], 10)
        }
      }

      // 获取所有幻灯片
      const slideFiles = Object.keys(unzipped)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0', 10)
          const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0', 10)
          return na - nb
        })

      if (slideFiles.length === 0) {
        setError('未在 PPTX 文件中检测到任何幻灯片页面')
        setLoading(false)
        return
      }

      const parsedList: ParsedSlide[] = []

      for (let idx = 0; idx < slideFiles.length; idx++) {
        const slidePath = slideFiles[idx]
        const xml = fflate.strFromU8(unzipped[slidePath])

        // 解析图片资源关系
        const relsPath = slidePath.replace('ppt/slides/slide', 'ppt/slides/_rels/slide') + '.rels'
        const imageMap = new Map<string, string>()
        if (unzipped[relsPath]) {
          const relsXml = fflate.strFromU8(unzipped[relsPath])
          const relMatches = relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)
          for (const rel of relMatches) {
            const relId = rel[1]
            let target = rel[2]
            if (target.startsWith('../')) {
              target = 'ppt/' + target.replace('../', '')
            } else if (!target.startsWith('ppt/')) {
              target = 'ppt/slides/' + target
            }
            if (unzipped[target]) {
              const mime = target.endsWith('.png')
                ? 'image/png'
                : target.endsWith('.jpeg') || target.endsWith('.jpg')
                  ? 'image/jpeg'
                  : target.endsWith('.svg')
                    ? 'image/svg+xml'
                    : 'image/png'
              const b64 = btoa(
                Array.from(unzipped[target])
                  .map((byte) => String.fromCharCode(byte))
                  .join(''),
              )
              imageMap.set(relId, `data:${mime};base64,${b64}`)
            }
          }
        }

        const shapes: SlideShape[] = []
        const images: SlideImage[] = []
        const plainText: string[] = []
        let detectedTitle = ''

        // 1. 提取 shapes
        const spMatches = xml.matchAll(/<p:sp>(.*?)<\/p:sp>/gs)
        for (const sp of spMatches) {
          const spXml = sp[1]
          const offMatch = spXml.match(/<a:off\s+x="(\d+)"\s+y="(\d+)"/)
          const extMatch = spXml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)

          const offX = offMatch ? parseInt(offMatch[1], 10) : 0
          const offY = offMatch ? parseInt(offMatch[2], 10) : 0
          const extW = extMatch ? parseInt(extMatch[1], 10) : slideW
          const extH = extMatch ? parseInt(extMatch[2], 10) : slideH

          // 提取 shape 背景颜色
          const solidFillMatch = spXml.match(/<p:spPr>.*?<a:solidFill>.*?<a:srgbClr\s+val="([0-9a-fA-F]{6})"/s)
          const bgColor = solidFillMatch ? `#${solidFillMatch[1]}` : undefined

          const pMatches = spXml.matchAll(/<a:p>(.*?)<\/a:p>/gs)
          const paras: SlideParagraph[] = []

          for (const p of pMatches) {
            const pXml = p[1]
            let align: 'left' | 'center' | 'right' = 'left'
            if (pXml.includes('algn="ctr"')) align = 'center'
            else if (pXml.includes('algn="r"')) align = 'right'

            const rMatches = pXml.matchAll(/<a:r>(.*?)<\/a:r>/gs)
            let fullParaText = ''
            let fontSize: number | undefined
            let isBold = false
            let color: string | undefined

            for (const r of rMatches) {
              const rXml = r[1]
              const tMatch = rXml.match(/<a:t[^>]*>(.*?)<\/a:t>/s)
              if (!tMatch) continue
              const t = tMatch[1]
              fullParaText += t

              const szMatch = rXml.match(/sz="(\d+)"/)
              if (szMatch && !fontSize) fontSize = Math.round(parseInt(szMatch[1], 10) / 100)

              if (rXml.includes('b="1"')) isBold = true

              const colorMatch = rXml.match(/<a:srgbClr\s+val="([0-9a-fA-F]{6})"/)
              if (colorMatch && !color) color = `#${colorMatch[1]}`
            }

            if (!fontSize) {
              const defSz = pXml.match(/<a:defRPr[^>]*sz="(\d+)"/)
              if (defSz) fontSize = Math.round(parseInt(defSz[1], 10) / 100)
            }
            if (!isBold && pXml.includes('b="1"')) isBold = true
            if (!color) {
              const defColor = pXml.match(/<a:defRPr>.*?<a:srgbClr\s+val="([0-9a-fA-F]{6})"/s)
              if (defColor) color = `#${defColor[1]}`
            }

            const trimmed = fullParaText.trim()
            if (trimmed) {
              paras.push({
                text: trimmed,
                fontSize,
                isBold,
                color,
                align,
              })
              plainText.push(trimmed)
              if (!detectedTitle) detectedTitle = trimmed
            }
          }

          if (paras.length > 0) {
            shapes.push({
              id: `sp-${shapes.length}`,
              x: Math.max(0, Math.min(100, (offX / slideW) * 100)),
              y: Math.max(0, Math.min(100, (offY / slideH) * 100)),
              w: Math.max(5, Math.min(100, (extW / slideW) * 100)),
              h: Math.max(5, Math.min(100, (extH / slideH) * 100)),
              bgColor,
              paragraphs: paras,
            })
          }
        }

        // 2. 提取 pictures
        const picMatches = xml.matchAll(/<p:pic>(.*?)<\/p:pic>/gs)
        for (const pic of picMatches) {
          const picXml = pic[1]
          const offMatch = picXml.match(/<a:off\s+x="(\d+)"\s+y="(\d+)"/)
          const extMatch = picXml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)
          const blipMatch = picXml.match(/<a:blip[^>]*r:embed="([^"]+)"/)

          if (blipMatch && imageMap.has(blipMatch[1])) {
            const offX = offMatch ? parseInt(offMatch[1], 10) : 0
            const offY = offMatch ? parseInt(offMatch[2], 10) : 0
            const extW = extMatch ? parseInt(extMatch[1], 10) : slideW
            const extH = extMatch ? parseInt(extMatch[2], 10) : slideH

            images.push({
              id: `pic-${images.length}`,
              x: Math.max(0, Math.min(100, (offX / slideW) * 100)),
              y: Math.max(0, Math.min(100, (offY / slideH) * 100)),
              w: Math.max(5, Math.min(100, (extW / slideW) * 100)),
              h: Math.max(5, Math.min(100, (extH / slideH) * 100)),
              src: imageMap.get(blipMatch[1])!,
            })
          }
        }

        parsedList.push({
          index: idx + 1,
          title: detectedTitle || `幻灯片 ${idx + 1}`,
          shapes,
          images,
          plainText,
        })
      }

      setSlides(parsedList)
      setLoading(false)
    } catch (err: unknown) {
      console.error('[PptxViewer] Parse failed:', err)
      setError(err instanceof Error ? err.message : 'PPTX 解析失败')
      setLoading(false)
    }
  }, [filePath])

  useEffect(() => {
    void loadAndParsePptx()
  }, [loadAndParsePptx])

  // 快捷键支持（翻页与全屏放映）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (slides.length === 0) return

      if (e.key === 'Escape' && isSlideShow) {
        e.preventDefault()
        setIsSlideShow(false)
        return
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || (isSlideShow && e.key === ' ')) {
        e.preventDefault()
        setActiveSlideIndex((prev) => {
          const next = Math.min(slides.length - 1, prev + 1)
          if (viewMode === 'deck' && !isSlideShow) {
            slideRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
          return next
        })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        setActiveSlideIndex((prev) => {
          const next = Math.max(0, prev - 1)
          if (viewMode === 'deck' && !isSlideShow) {
            slideRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
          return next
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSlideShow, slides.length, viewMode])

  // 生成结构化 Markdown 大纲文本
  const markdownOutline = useMemo(() => {
    if (slides.length === 0) return ''
    const lines: string[] = [`# ${filePath.split(/[/\\]/).pop() ?? '演示文稿'} 大纲\n`]
    slides.forEach((slide) => {
      lines.push(`## 第 ${slide.index} 页：${slide.title}`)
      slide.shapes.forEach((shape) => {
        shape.paragraphs.forEach((p) => {
          if (p.text !== slide.title) {
            if (p.isBold || (p.fontSize && p.fontSize >= 16)) {
              lines.push(`\n### ${p.text}`)
            } else {
              lines.push(`- ${p.text}`)
            }
          }
        })
      })
      lines.push('')
    })
    return lines.join('\n')
  }, [filePath, slides])

  // 复制大纲到剪贴板
  const handleCopyOutline = async () => {
    if (!markdownOutline) return
    try {
      await navigator.clipboard.writeText(markdownOutline)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const fileName = filePath.split(/[/\\]/).pop() ?? filePath
  const currentSlide = slides[activeSlideIndex] ?? slides[0]

  // 单张幻灯片画布渲染组件
  const renderSlideCanvas = (slide: ParsedSlide, isFullscreen = false) => {
    return (
      <div
        className={cn(
          'relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border/80 bg-white shadow-md transition-all select-text',
          'dark:bg-slate-950 dark:border-slate-800 dark:shadow-2xl',
          isFullscreen ? 'shadow-2xl ring-1 ring-border' : 'hover:shadow-lg',
        )}
      >
        {/* 背景轻微渐变或色调增强 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/[0.02] dark:to-white/[0.02]" />

        {/* 渲染所有形状与段落 */}
        {slide.shapes.map((shape) => {
          return (
            <div
              key={shape.id}
              style={{
                position: 'absolute',
                left: `${shape.x}%`,
                top: `${shape.y}%`,
                width: `${shape.w}%`,
                height: `${shape.h}%`,
                backgroundColor: shape.bgColor,
              }}
              className={cn(
                'flex flex-col justify-start overflow-hidden p-1',
                shape.bgColor && 'rounded-md p-3 shadow-xs',
              )}
            >
              {shape.paragraphs.map((p, pIdx) => {
                // 依据原 pt 转换为比例字号
                const isHeading = (p.fontSize && p.fontSize >= 24) || (p.isBold && p.fontSize && p.fontSize >= 20)
                const isSubheading = (p.fontSize && p.fontSize >= 16) || p.isBold
                return (
                  <div
                    key={pIdx}
                    style={{
                      textAlign: p.align ?? 'left',
                      color: p.color,
                    }}
                    className={cn(
                      'leading-snug break-words tracking-tight text-slate-900 dark:text-slate-100',
                      isHeading
                        ? 'mb-2 text-lg font-bold md:text-xl lg:text-2xl text-slate-950 dark:text-white'
                        : isSubheading
                          ? 'mb-1 text-sm font-semibold md:text-base text-primary'
                          : 'mb-1 text-xs text-slate-700 md:text-sm dark:text-slate-300',
                      p.isBold && 'font-bold',
                    )}
                  >
                    {p.text}
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* 渲染图片 */}
        {slide.images.map((img) => (
          <img
            key={img.id}
            src={img.src}
            alt=""
            style={{
              position: 'absolute',
              left: `${img.x}%`,
              top: `${img.y}%`,
              width: `${img.w}%`,
              height: `${img.h}%`,
              objectFit: 'contain',
            }}
            className="pointer-events-none"
          />
        ))}

        {/* 右下角极简页脚序号 */}
        <div className="absolute right-3 bottom-2 text-[10px] font-mono text-slate-400 select-none dark:text-slate-600">
          {slide.index} / {slides.length}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-full w-full flex-col bg-background text-foreground', className)}>
      {/* 顶部现代化操作条 */}
      <div className="flex flex-wrap items-center justify-between border-b border-border bg-muted/40 px-3 py-2 text-xs backdrop-blur-sm">
        {/* 左侧：文件信息与分页指示 */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Presentation className="size-4 text-primary" />
            <span className="max-w-[200px] truncate" title={fileName}>
              {fileName}
            </span>
          </span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-primary">
            PPTX 演示
          </span>
          {slides.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              共 {slides.length} 页（当前第 {activeSlideIndex + 1} 页）
            </span>
          )}
        </div>

        {/* 右侧：视图切换、大纲提取、缩放、演示放映 */}
        <div className="flex items-center gap-1.5">
          {/* 大纲侧栏切换 */}
          <Button
            variant={showOutline ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => setShowOutline((prev) => !prev)}
            title="切换大纲侧栏"
            className="h-7 gap-1 text-[11px]"
          >
            <LayoutList className="size-3.5" />
            <span>大纲速览</span>
          </Button>

          {/* 视图模式：瀑布流 / 单页 */}
          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <Button
              variant={viewMode === 'deck' ? 'secondary' : 'ghost'}
              size="icon-xs"
              onClick={() => setViewMode('deck')}
              title="瀑布流连续浏览"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <Columns className="size-3" />
            </Button>
            <Button
              variant={viewMode === 'single' ? 'secondary' : 'ghost'}
              size="icon-xs"
              onClick={() => setViewMode('single')}
              title="单页精读模式"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <FileText className="size-3" />
            </Button>
          </div>

          {/* 缩放控制 */}
          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              title="缩小"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <ZoomOut className="size-3" />
            </Button>
            <span className="min-w-10 text-center font-mono text-[11px] text-foreground select-none">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.min(200, z + 10))}
              title="放大"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <ZoomIn className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom(100)}
              title="恢复 100%"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
            </Button>
          </div>

          {/* 一键提取复制 Markdown 大纲 */}
          <Button
            variant="outline"
            size="xs"
            onClick={handleCopyOutline}
            title="一键提取并复制 PPT 结构化 Markdown 大纲"
            className="h-7 gap-1 text-[11px]"
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            <span>{copied ? '已复制大纲' : '提炼大纲'}</span>
          </Button>

          {/* 全屏放映演示 */}
          <Button
            variant="default"
            size="xs"
            onClick={() => setIsSlideShow(true)}
            title="全屏演示放映（快捷键：空格/方向键翻页，Esc 退出）"
            className="h-7 gap-1 bg-primary text-primary-foreground text-[11px] font-medium shadow-xs"
          >
            <Play className="size-3 fill-current" />
            <span>幻灯片放映</span>
          </Button>

          {/* 重新加载 */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void loadAndParsePptx()}
            title="重新解析"
            disabled={loading}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* 核心主展示区（带侧栏大纲 + 主画布） */}
      <div className="relative flex flex-1 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-xs">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">正在解析 PPTX 演示文稿幻灯片...</span>
          </div>
        )}

        {error && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <div className="text-sm font-medium text-destructive">{error}</div>
            <Button variant="outline" size="sm" onClick={() => void loadAndParsePptx()} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              重试加载
            </Button>
          </div>
        )}

        {!loading && !error && slides.length > 0 && (
          <>
            {/* 左侧大纲与幻灯片缩略列表 */}
            {showOutline && (
              <div className="flex w-64 flex-col border-r border-border bg-muted/20 shrink-0">
                <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  <span>幻灯片列表</span>
                  <span className="font-mono text-[10px]">{slides.length} 页</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2 montree-sheet-scroll">
                  {slides.map((s, idx) => {
                    const isActive = idx === activeSlideIndex
                    return (
                      <div
                        key={s.index}
                        onClick={() => {
                          setActiveSlideIndex(idx)
                          if (viewMode === 'deck') {
                            slideRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }
                        }}
                        className={cn(
                          'group flex cursor-pointer flex-col gap-1 rounded-md border p-2 text-left transition-all',
                          isActive
                            ? 'border-primary bg-primary/10 shadow-xs'
                            : 'border-border/60 bg-background/60 hover:border-border hover:bg-background',
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              'font-mono text-[10px] font-bold',
                              isActive ? 'text-primary' : 'text-muted-foreground',
                            )}
                          >
                            P{String(s.index).padStart(2, '0')}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.shapes.length} 个元素
                          </span>
                        </div>
                        <div
                          className={cn(
                            'truncate text-xs font-medium',
                            isActive ? 'text-primary font-semibold' : 'text-foreground',
                          )}
                          title={s.title}
                        >
                          {s.title}
                        </div>
                        {s.plainText.length > 1 && (
                          <div className="line-clamp-2 text-[10px] text-muted-foreground">
                            {s.plainText.slice(1).join(' ')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 右侧主画布内容区 */}
            <div className="relative flex-1 overflow-auto bg-muted/30 p-4 md:p-8 montree-sheet-scroll">
              <div
                className="mx-auto flex flex-col items-center transition-transform duration-150"
                style={{
                  width: `${zoom}%`,
                  maxWidth: '1280px',
                  minWidth: '320px',
                }}
              >
                {viewMode === 'deck' ? (
                  /* 瀑布流连续浏览模式 */
                  <div className="w-full space-y-8">
                    {slides.map((slide, idx) => (
                      <div
                        key={slide.index}
                        ref={(el) => {
                          slideRefs.current[idx] = el
                        }}
                        className="flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                          <span className="font-mono font-medium">第 {slide.index} 页 · {slide.title}</span>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setActiveSlideIndex(idx)
                              setIsSlideShow(true)
                            }}
                            className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <Play className="size-2.5 fill-current" />
                            <span>从本页放映</span>
                          </Button>
                        </div>
                        {renderSlideCanvas(slide)}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* 单页精读模式 */
                  <div className="flex w-full flex-col items-center gap-4">
                    <div className="flex w-full items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={activeSlideIndex === 0}
                        onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
                        className="gap-1 text-xs"
                      >
                        <ChevronLeft className="size-3.5" />
                        上一页
                      </Button>
                      <span className="font-mono text-xs font-medium text-muted-foreground">
                        {activeSlideIndex + 1} / {slides.length}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={activeSlideIndex === slides.length - 1}
                        onClick={() => setActiveSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
                        className="gap-1 text-xs"
                      >
                        下一页
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </div>

                    <div className="w-full">
                      {renderSlideCanvas(currentSlide)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 全屏放映演示 Overlay 遮罩 */}
      {isSlideShow && currentSlide && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4 md:p-8 backdrop-blur-md">
          {/* 放映画布容器 */}
          <div className="relative flex max-h-[85vh] w-full max-w-6xl items-center justify-center">
            {renderSlideCanvas(currentSlide, true)}
          </div>

          {/* 悬浮底部演讲控制条 */}
          <div className="fixed bottom-6 flex items-center gap-3 rounded-full border border-white/20 bg-black/80 px-4 py-2 text-white shadow-2xl backdrop-blur-md">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={activeSlideIndex === 0}
              onClick={() => setActiveSlideIndex((prev) => Math.max(0, prev - 1))}
              title="上一页（←）"
              className="size-7 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <span className="font-mono text-xs font-semibold tracking-wider text-white select-none">
              {activeSlideIndex + 1} / {slides.length}
            </span>

            <Button
              variant="ghost"
              size="icon-xs"
              disabled={activeSlideIndex === slides.length - 1}
              onClick={() => setActiveSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
              title="下一页（→ 或空格）"
              className="size-7 text-white/80 hover:bg-white/20 hover:text-white"
            >
              <ChevronRight className="size-4" />
            </Button>

            <div className="h-4 w-px bg-white/20 mx-1" />

            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsSlideShow(false)}
              title="退出放映（Esc）"
              className="h-7 gap-1 text-xs text-white/80 hover:bg-white/20 hover:text-white"
            >
              <Minimize2 className="size-3.5" />
              <span>退出放映</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
