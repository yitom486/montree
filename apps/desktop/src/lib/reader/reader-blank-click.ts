/** 只认阅读正文内的真实空白点击，跨 iframe 时使用该文档自己的坐标和 Selection。 */
export function isReaderBlankClick(event: MouseEvent, root: HTMLElement): boolean {
  if (event.button !== 0 || event.detail > 1 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  const target = event.target as Element | null
  if (!target || target.nodeType !== 1 || !root.contains(target)) return false
  const doc = root.ownerDocument
  if (doc.getSelection()?.isCollapsed === false) return false
  if (target.closest('a,button,input,textarea,select,[contenteditable="true"],[role="button"],[role="menu"],img,video,audio,svg,[data-reading-mark-id],[data-mark-id]')) return false
  if (target.closest('canvas') && !target.closest('.pdf-page-wrapper')) return false
  const box = root.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom) return false
  // 滚动条上的按下/松开不算放弃翻译。
  if (root.offsetWidth > root.clientWidth && event.clientX >= box.left + root.clientWidth) return false
  const caret = doc.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (caret?.startContainer.nodeType === 3) {
    const node = caret.startContainer as Text
    for (const index of [caret.startOffset - 1, caret.startOffset]) {
      if (index < 0 || index >= node.length || !node.data[index]?.trim()) continue
      const char = doc.createRange()
      char.setStart(node, index)
      char.setEnd(node, index + 1)
      if (Array.from(char.getClientRects()).some(rect => event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom)) return false
    }
  }
  return true
}
