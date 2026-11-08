import { webDocApi } from '@/api/web-doc-api'

/** 原图正常时直连；CORP/网络失败后由受限主进程接口恢复，仅影响本阅读文档。 */
export function bindWebDocImageRecovery(doc: Document, pageUrl: string): () => void {
  const attempted = new WeakMap<HTMLImageElement, string>()
  const queue: Array<() => Promise<void>> = []
  let active = 0
  let disposed = false
  const drain = () => {
    while (!disposed && active < 4 && queue.length) {
      active++
      void queue.shift()!().finally(() => { active--; drain() })
    }
  }
  const recover = (image: HTMLImageElement) => {
    const source = image.currentSrc || image.getAttribute('src') || ''
    let url: string
    try {
      const parsed = new URL(source, pageUrl)
      if (!source || !['http:', 'https:'].includes(parsed.protocol)) return
      url = parsed.href
    } catch { return }
    if (attempted.get(image) === url) return
    attempted.set(image, url)
    queue.push(async () => {
      try {
        const result = await webDocApi.fetchImage({ url, pageUrl })
        if (disposed || !image.isConnected || !result.ok || image.ownerDocument !== doc) return
        // picture/srcset 优先级高于 img.src；恢复后避免浏览器继续选择被拒绝的远程候选。
        image.closest('picture')?.querySelectorAll('source').forEach(source => source.removeAttribute('srcset'))
        image.removeAttribute('srcset')
        image.setAttribute('data-montree-image-source', url)
        image.src = result.value.dataUrl
      } catch { /* 保留 alt；下次重新打开页面时可再尝试，不在 error 事件里无限重试。 */ }
    })
    drain()
  }
  const onError = (event: Event) => {
    const target = event.target as HTMLImageElement | null
    if (target?.tagName?.toLowerCase() === 'img') recover(target)
  }
  doc.addEventListener('error', onError, true)
  // iframe load 通常晚于图片 error，必须补收已经失败的图片。
  doc.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    if (image.complete && image.naturalWidth === 0) recover(image)
  })
  return () => { disposed = true; queue.length = 0; doc.removeEventListener('error', onError, true) }
}
