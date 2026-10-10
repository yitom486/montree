import { WidgetType } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import DOMPurify from 'dompurify'
import { renderPreview } from '@/lib/preview/render-preview'

/** 所见即所得下的图片渲染 Widget（非聚焦时就地渲染真实图片） */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly filePath?: string,
  ) {
    super()
  }

  toDOM(view?: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-live-image-wrap'
    wrap.setAttribute('role', 'img')
    wrap.setAttribute('aria-label', this.alt || 'Markdown 图片')

    const img = document.createElement('img')
    const safe = document.createElement('template')
    safe.innerHTML = String(DOMPurify.sanitize(`<img src="${this.src.replace(/"/g, '&quot;')}">`))
    img.src = safe.content.querySelector('img')?.getAttribute('src') ?? ''
    img.alt = this.alt || ''
    img.className = 'cm-live-image'
    img.loading = 'lazy'
    img.title = this.alt ? `${this.alt} (点击展开源码)` : '点击展开源码'
    img.onload = () => { if (wrap.isConnected) view?.requestMeasure() }

    // 图片加载失败保护 fallback
    img.onerror = () => {
      const error = document.createElement('span')
      error.className = 'cm-live-image-error'
      error.textContent = `图片无法加载: ${this.alt || this.src}`
      wrap.replaceChildren(error)
    }

    wrap.appendChild(img)
    if (this.filePath) {
      const markup = `<img src="${this.src.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
      void renderPreview(markup, this.filePath).then((html) => {
        if (!wrap.isConnected) return
        safe.innerHTML = html
        const resolved = safe.content.querySelector('img')?.getAttribute('src')
        if (resolved) { img.src = resolved; wrap.replaceChildren(img); view?.requestMeasure() }
      }).catch(() => {})
    }
    return wrap
  }

  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt && this.filePath === other.filePath
  }

  ignoreEvent(): boolean {
    return false
  }
}
