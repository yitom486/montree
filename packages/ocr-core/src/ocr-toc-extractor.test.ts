import { describe, expect, it } from 'vitest'
import {
  backfillMissingPages,
  cleanupOcrTocTitle,
  extractOcrTocFromText,
  inferLevel,
  isBareChapterTitle,
  isDigitSoupTitle,
  isWatermarkTocEntry,
  normalizeOcrChinese,
  splitStuckSections,
} from './ocr-toc-extractor'

describe('ocr-toc-extractor', () => {
  it('normalizeOcrChinese 合并汉字间空格', () => {
    expect(normalizeOcrChinese('计 算 机 发 展')).toBe('计算机发展')
  })

  it('从目录 OCR 文本提取章节', () => {
    const sample = `
日 录
#]1 1 计算 机 发 展 历 程 2
111 计算 机 硬件 的 发 展 1
112 计算 机 软件 的 发 展 2
12.6 计算 机 系统 的 工作 原 理 7
12.8 答案 与 解析 9
第 2 章 数据 的 表示 和 运算 20
2.12 定 点 数 的 编码 表示 2
官方 开源 ， 高 清 带 书签 PDF
`
    const entries = extractOcrTocFromText(sample)
    const titles = entries.map((e) => e.title)
    expect(titles.some((t) => t.includes('计算机发展') || t.startsWith('第1章'))).toBe(true)
    expect(titles.some((t) => t.includes('12.6') && t.includes('工作原理'))).toBe(true)
    expect(entries.every((e) => e.printedPage > 0)).toBe(true)
    expect(entries.some((e) => e.raw.includes('官方'))).toBe(false)
  })

  it('无页码父项从后继条目继承页码', () => {
    const entries = extractOcrTocFromText('第3章 存储系统\n3.1 主存储器\n3.1.1 概述 45\n3.1.2 组成 47\n')
    const byTitle = new Map(entries.map((e) => [e.title, e.printedPage]))
    // 章行无数字必是数字丢失（真目录章必带页码），不继承只丢弃
    expect(byTitle.has('第3章存储系统')).toBe(false)
    // 节父项与长子同起一页，继承合理
    expect(byTitle.get('3.1主存储器')).toBe(45)
    expect(byTitle.get('3.1.1概述')).toBe(45)
    // 尾部无后继的不收留
    expect(extractOcrTocFromText('3.1.1 概述 45\n尾部无页码父项')).toHaveLength(1)
  })

  it('同级兄弟不回填（防数字涂抹），仅父项继承长子', () => {
    const siblings = ['3.1 父项', '3.2 父项', '3.3 父项', '3.4 父项', '3.5 落点 45'].join('\n')
    // 3.1..3.4 与 3.5 同为 level1 兄弟：继承必错位，一律丢弃只留落点
    expect(extractOcrTocFromText(siblings).map((e) => e.title)).toEqual(['3.5落点'])
    // 父项 level1 < 长子 level2：继承合理（父与长子同起一页）
    const parent = extractOcrTocFromText('3.1 父项\n3.1.1 长子 45\n')
    expect(parent.map((e) => `${e.title}|${e.printedPage}`)).toEqual(['3.1父项|45', '3.1.1长子|45'])
  })

  it('水印碎片不成目录条目', () => {
    // 6 位以上纯数字群号/碎片
    expect(isWatermarkTocEntry('87929797资料')).toBe(true)
    // 通用引流/营销特征
    expect(isWatermarkTocEntry('https://example.com')).toBe(true)
    expect(isWatermarkTocEntry('扫码获取视频')).toBe(true)
    expect(isWatermarkTocEntry('交流群')).toBe(true)
    // 外部注入的已知水印集合
    expect(isWatermarkTocEntry('自定义水印碎片', ['自定义水印'])).toBe(true)
    // 真实章节不误伤
    expect(isWatermarkTocEntry('1.2.6 计算机系统的工作原理')).toBe(false)
    expect(isWatermarkTocEntry('第1章 计算机系统概述')).toBe(false)
    expect(isWatermarkTocEntry('精选训练营教程')).toBe(false)

    const entries = extractOcrTocFromText('87929797群号 149\n3.1.2主存储器的组成 31\n')
    expect(entries.map((e) => e.title)).toEqual(['3.1.2主存储器的组成'])
  })

  it('数字汤不成目录条目（短节名豁免）', () => {    expect(isDigitSoupTitle('…251254王道238242242')).toBe(true)
    expect(isDigitSoupTitle('3.1.2主存储器的组成和基本操作')).toBe(false)
    expect(isDigitSoupTitle('3.1.1概述')).toBe(false)
    expect(isDigitSoupTitle('第1章 计算机系统概述')).toBe(false)
    const entries = extractOcrTocFromText('3.1.2 主存储器的组成 78\n…251254王道238242242 254\n')
    expect(entries.map((e) => e.title)).toEqual(['3.1.2主存储器的组成'])
  })

  it('三段号是小节 level2（防侧栏扁平与同级回填）', () => {
    expect(inferLevel('第1章 概述')).toBe(0)
    expect(inferLevel('入门单元')).toBe(0)
    expect(inferLevel('第1单元 小李赴日')).toBe(0)
    expect(inferLevel('I. 日语的发音')).toBe(1)
    expect(inferLevel('II. 日语的文字与书写方法')).toBe(1)
    expect(inferLevel('第1课 李さんは中国...')).toBe(1)
    expect(inferLevel('2.1 数制')).toBe(1)
    expect(inferLevel('2.1.1 进制')).toBe(2)
    expect(inferLevel('3.5.4 替换算法')).toBe(2)
    expect(cleanupOcrTocTitle('*7.1.1输入/输出系统')).toBe('7.1.1输入/输出系统')
    expect(cleanupOcrTocTitle('1.1历程①')).toBe('1.1历程')
  })

  it('错序回正、倒退页码丢弃（3.5.4→85 不许留在 111 后面）', () => {
    const entries = extractOcrTocFromText(
      ['3.5.3 映射 111', '3.5.5 一致性 115', '3.5.7 应用 116', '3.5.4 替换算法 85'].join('\n'),
    )
    const titles = entries.map((e) => e.title)
    // 按章节号回正：3.5.4 应在 3.5.3/3.5.5 之间；但 85<111 倒退即错配，直接丢弃
    expect(titles).toEqual(['3.5.3映射', '3.5.5一致性', '3.5.7应用'])
    expect(titles.some((t) => t.includes('3.5.4'))).toBe(false)
  })

  it('顺序正确时按章节号回正（2.2.4→39 回到 2.2.5 之前）', () => {
    const entries = extractOcrTocFromText(
      ['2.2.5 习题 44', '2.2.3 加减 35', '2.2.4 乘除 39'].join('\n'),
    )
    expect(entries.map((e) => e.title)).toEqual(['2.2.3加减', '2.2.4乘除', '2.2.5习题'])
  })

  it('无星号双章节号黏连拆分（4.3.5+4.4），行尾页码归第一段', () => {
    expect(splitStuckSections('4.3.5本节习题精选4.4CISC和RISC的基本概念')).toEqual([
      '4.3.5本节习题精选',
      '4.4CISC和RISC的基本概念',
    ])
    expect(splitStuckSections('4.3.5本节习题精选4.4CISC和RISC的基本概念 181')).toEqual([
      '4.3.5本节习题精选 181',
      '4.4CISC和RISC的基本概念',
    ])
    // 单章节号、末尾纯页码、表格行一律不动
    expect(splitStuckSections('3.1.2 主存储器的组成和基本操作…… 78')).toEqual([
      '3.1.2 主存储器的组成和基本操作…… 78',
    ])
    expect(splitStuckSections('|2.1.2 定点数的编码表示·|…22|')).toEqual([
      '|2.1.2 定点数的编码表示·|…22|',
    ])
    expect(splitStuckSections('第3单元小李在箱根113第9课四川料理')).toEqual([
      '第3单元小李在箱根113',
      '第9课四川料理',
    ])
    expect(splitStuckSections('I.日语的发音2II.日语的文字与书写方法')).toEqual([
      'I.日语的发音2',
      'II.日语的文字与书写方法',
    ])
    expect(splitStuckSections('2.3.1 IEEE 754 标准的浮点数')).toEqual([
      '2.3.1 IEEE 754 标准的浮点数',
    ])
    // 拆开后 4.4 按父子规则从 4.4.1 继承（同起一页），不再是错页 181
    const entries = extractOcrTocFromText(
      ['4.3.4 过程调用 179', '4.3.5本节习题精选4.4CISC和RISC的基本概念 181', '4.4.1 复杂指令 191'].join('\n'),
    )
    const byTitle = new Map(entries.map((e) => [e.title, e.printedPage]))
    expect(byTitle.get('4.3.5本节习题精选')).toBe(181)
    expect(byTitle.get('4.4CISC和RISC的基本概念')).toBe(191)
  })

  it('* 黏连行拆成多条（删纲标记）', () => {
    const entries = extractOcrTocFromText('*7.1.1 输入/输出系统 *7.1.2 外部设备\n7.1.3 有页码 291\n')
    // 7.1.1/7.1.2 与 7.1.3 同级不继承，只留落点；拆分本身不断言页码，只断言不吞条
    expect(entries.some((e) => e.title.includes('7.1.3'))).toBe(true)
  })

  it('证据来源标记（pipe 钉死 / 回填推测）', () => {
    const opts = { pageCount: 340, pageOffset: 12 }
    const piped = extractOcrTocFromText('|2.2运算方法和运算电路|32|', opts)
    expect(piped[0]).toMatchObject({ title: '2.2运算方法和运算电路', printedPage: 32, source: 'pipe' })
    const filled = extractOcrTocFromText('3.1 父项\n3.1.1 长子 45\n', opts)
    const byTitle = new Map(filled.map((e) => [e.title, e.source]))
    expect(byTitle.get('3.1父项')).toBe('backfilled')
    expect(byTitle.get('3.1.1长子')).toBe('paired')
  })

  it('backfillMissingPages 纯函数语义', () => {
    expect(isBareChapterTitle('第3章 存储系统')).toBe(true)
    expect(isBareChapterTitle('3.1 主存储器')).toBe(false)
    const filled = backfillMissingPages([
      { title: '第3章', printedPage: null, level: 0 },
      { title: '3.1', printedPage: null, level: 1 },
      { title: '3.1.1', printedPage: 45, level: 2 },
    ])
    // 章无章节号前缀、调用方另行过滤：第3章不继承只丢弃，3.1←3.1.1 父子继承
    expect(filled.map((e) => e.printedPage)).toEqual([null, 45, 45])
  })
})
