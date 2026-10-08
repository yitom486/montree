import { describe, expect, it } from 'vitest'
import {
  allocateSentenceTimeline,
  findCurrentSentenceIndex,
  findViewportStartingSentenceIndex,
  sanitizeReaderText,
} from './text-sanitizer'

describe('text-sanitizer', () => {
  it('应当过滤角标数字、脚注和上标字符', () => {
    const raw = `这是正文第一句[1]，包含角标数字。这是第二句[^note]，包含脚注引用¹²³。
[^note]: 这里是脚注的具体解释，不应该被读出。`

    const result = sanitizeReaderText(raw)
    expect(result.fullCleanText).toContain('这是正文第一句，包含角标数字。')
    expect(result.fullCleanText).toContain('这是第二句，包含脚注引用。')
    expect(result.fullCleanText).not.toContain('[1]')
    expect(result.fullCleanText).not.toContain('[^note]')
    expect(result.fullCleanText).not.toContain('¹²³')
    expect(result.fullCleanText).not.toContain('这里是脚注的具体解释')
  })

  it('应当精准过滤圆括号数字角标、带圈数字，同时完整保留正文语义括注', () => {
    // 真实书籍案例（义和拳运动起源探索）
    const raw = `在这篇拳论中,他将“儒家思想渗透进去”(5),同时杨炳还是梅花拳中唯一入仕的人(中康熙壬辰科武探花)。他的“卫君卫国”“不可犯上作乱”的忠君思想是毫无疑问的。梅花拳是“依附于无为教的一个秘密会社”(6)。文武场之分①，也被看作是与教门的联系（7）。`

    const result = sanitizeReaderText(raw)
    // 1. (5), (6), (7), ① 应当被完全去除
    expect(result.fullCleanText).not.toContain('(5)')
    expect(result.fullCleanText).not.toContain('(6)')
    expect(result.fullCleanText).not.toContain('（7）')
    expect(result.fullCleanText).not.toContain('①')

    // 2. 正文语义夹注 (中康熙壬辰科武探花) 必须完整保留
    expect(result.fullCleanText).toContain('(中康熙壬辰科武探花)')

    // 3. 标点贴合正常
    expect(result.fullCleanText).toContain('他将“儒家思想渗透进去”，同时')
    expect(result.fullCleanText).toContain('依附于无为教的一个秘密会社”。')
  })

  it('应当保留链接文本，剔除跳转 URL 与裸链接', () => {
    const raw = `请点击[Montree 官方网站](https://example.com/montree)了解详情。也可以看 <a href="http://docs.org">开发文档</a>。裸链接 https://github.com/montree 不应读出。`

    const result = sanitizeReaderText(raw)
    expect(result.fullCleanText).toContain('请点击Montree 官方网站了解详情。')
    expect(result.fullCleanText).toContain('也可以看 开发文档。')
    expect(result.fullCleanText).not.toContain('https://example.com/montree')
    expect(result.fullCleanText).not.toContain('http://docs.org')
    expect(result.fullCleanText).not.toContain('https://github.com/montree')
  })

  it('应当清洗 Markdown 标题、粗体、引用符号与图片', () => {
    const raw = `# 章节第一节
![配图说明](https://img.png)
> 这是一段**重要引用**和*强调文字*。
---`

    const result = sanitizeReaderText(raw)
    expect(result.fullCleanText).toContain('章节第一节')
    expect(result.fullCleanText).toContain('这是一段重要引用和强调文字。')
    expect(result.fullCleanText).not.toContain('#')
    expect(result.fullCleanText).not.toContain('![配图说明]')
    expect(result.fullCleanText).not.toContain('**')
    expect(result.fullCleanText).not.toContain('---')
  })

  it('应当准确分句并按总时长分配时间轴', () => {
    const raw = `第一句在此。第二句很长很长很长？第三句呢！`
    const { sentences } = sanitizeReaderText(raw)

    expect(sentences.length).toBe(3)
    expect(sentences[0].text).toBe('第一句在此。')
    expect(sentences[1].text).toBe('第二句很长很长很长？')
    expect(sentences[2].text).toBe('第三句呢！')

    const withTimeline = allocateSentenceTimeline(sentences, 10) // 10秒音频
    expect(withTimeline[0].startTime).toBe(0)
    expect(withTimeline[2].endTime).toBe(10)
    expect(withTimeline[1].startTime).toBe(withTimeline[0].endTime)
  })

  it('应当准确定位视口顶部句子作为起始朗读索引', () => {
    const raw = `第一句在此。第二句很长很长很长？第三句是现在有机会将它奉献给读者！第四句结束了。`
    const { sentences } = sanitizeReaderText(raw)

    // 视口中显示的是第三句
    const viewportSnippet = `现在有机会将它奉献给读者！第四句`
    const matchIdx = findViewportStartingSentenceIndex(sentences, viewportSnippet)
    expect(matchIdx).toBe(2)

    // 空视口退回第 0 句
    expect(findViewportStartingSentenceIndex(sentences, '')).toBe(0)
  })

  it('应当保留 HTML 自然段落结构且不在段内句子间强插换行符', () => {
    const rawHtml = `<p>第一段第一句。第一段第二句！</p><p>第二段只有一句。</p>`
    const { fullCleanText, sentences } = sanitizeReaderText(rawHtml)

    // 段落间由双换行分隔
    expect(fullCleanText).toBe('第一段第一句。第一段第二句！\n\n第二段只有一句。')
    // 句子独立性仍然保持完整用于精准高亮
    expect(sentences).toHaveLength(3)
    expect(sentences[0].text).toBe('第一段第一句。')
    expect(sentences[1].text).toBe('第一段第二句！')
    expect(sentences[2].text).toBe('第二段只有一句。')
    expect(sentences[1].isParagraphEnd).toBe(true)
    expect(sentences[2].isParagraphEnd).toBe(true)
  })
})
