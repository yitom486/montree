/** 单次返回给 Agent 的正文上限：一章再长也不该一次灌满上下文 */
export const READER_TEXT_MAX_CHARS = 20_000

/** 视口文本上限：一屏通常远小于此，仅作安全阀 */
export const VIEWPORT_TEXT_MAX_CHARS = 8_000

export interface ReaderUnitText {
  /** 人类可读定位：章节标题或「第 N 页」 */
  label: string
  text: string
}

export interface ReaderContentProvider {
  /** provider 所属文件，切档时用于校验，避免返回上一本书的内容 */
  filePath: string
  /**
   * 罗盘指纹（`路径|字节数`，与 PdfViewer 的 fileFingerprint 同源）。
   * 仅已入库链路需要的 Viewer 设置；缺省表示该文档不支持库审计，
   * 快照侧据此拒绝而非编造指纹。
   */
  fileFingerprint?: string
  /**
   * S1 搜索闸门：仅 PDF Viewer 在扫描/混合未入库时赋值；
   * searchReaderContent 见到它直接抛错，不进入 iterateUnits（防整书 OCR）。
   * Foliate / WebDoc 不要设这个字段。
   */
  searchBlockedReason?: string
  /**
   * S2 搜索来源标注：仅 PDF Viewer 设置（有罗盘索引为 index，否则 memory）；
   * Foliate / WebDoc 不要设（缺省即 memory）。只影响 search 结果的 source
   * 字段，不改变任何检索算法。
   */
  searchSource?: 'memory' | 'index'
  /** 当前章节 / 页的纯文本；EPUB/MOBI 取 iframe DOM，PDF 取 textContent，MD 取编辑器内容 */
  getCurrentText: () => Promise<string> | string
  /**
   * 当前窗口可见纯文本（约一屏）。EPUB/MOBI 取视口块；PDF 取当前页。
   * 未实现时 readViewportText 会报错（不要静默退回整章）。
   */
  getViewportText?: () => Promise<string> | string
  /**
   * 全书逐单元正文，供检索使用。惰性产出：命中够了就 break，
   * 不会把整本书一次性读进内存。不实现则该格式不支持检索。
   */
  iterateUnits?: () => AsyncIterable<ReaderUnitText>
  /**
   * 按目录 flatIndex 取某一单元正文（不跳转）。
   * 与 montree_get_toc.entries[].index 对齐；未实现时 readChapterByRef 会退回 iterateUnits。
   */
  getUnitByIndex?: (flatIndex: number) => Promise<ReaderUnitText | null> | ReaderUnitText | null
}

let current: ReaderContentProvider | null = null

/**
 * 各 Viewer 在 mount 时注册，unmount 时注销。
 * 同一时刻只有一个主区文档，因此只保留最后注册的那个。
 */
export function registerReaderContent(provider: ReaderContentProvider): () => void {
  current = provider
  return () => {
    if (current === provider) current = null
  }
}

export function getReaderContentProvider(): ReaderContentProvider | null {
  return current
}

/** 折叠空白并截断，避免把整本书塞进一次工具返回 */
export function normalizeReaderText(raw: string, maxChars = READER_TEXT_MAX_CHARS): string {
  const text = raw.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n…[已截断：过长，仅返回前 ${maxChars} 字]`
}

export async function readCurrentDocumentText(expectedFilePath?: string): Promise<string> {
  const provider = current
  if (!provider) {
    throw new Error('当前没有打开的文档，或该格式暂不支持提取正文')
  }
  if (expectedFilePath && provider.filePath !== expectedFilePath) {
    throw new Error('文档刚刚切换，请重新获取当前文档信息后再试')
  }
  return normalizeReaderText(await provider.getCurrentText())
}

/** 当前窗口可见文本；未注册 getViewportText 时明确报错，避免误返回整章 */
export async function readViewportText(expectedFilePath?: string): Promise<string> {
  const provider = current
  if (!provider) {
    throw new Error('当前没有打开的文档，或该格式暂不支持提取正文')
  }
  if (expectedFilePath && provider.filePath !== expectedFilePath) {
    throw new Error('文档刚刚切换，请重新获取当前文档信息后再试')
  }
  if (!provider.getViewportText) {
    throw new Error('当前文档不支持视口文本（Markdown 请直接读文件；阅读器用 montree_read(scope=viewport)）')
  }
  return normalizeReaderText(await provider.getViewportText(), VIEWPORT_TEXT_MAX_CHARS)
}
