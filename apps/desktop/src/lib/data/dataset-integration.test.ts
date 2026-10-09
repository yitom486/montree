import { describe, expect, it } from 'vitest'
import { CsvDataset } from './csv-dataset'
import { JsonTreeModel } from './json-tree-model'
import { LogDataset } from './log-parser'

describe('CSV 真实文本数据集集成测试（解析、增删改查与序列化闭环）', () => {
  // 真实商业报表样本：含普通文本、数值、带逗号字段、带换行字段、带双引号转义字段
  const sampleCsvText = `ID,姓名,部门,薪资,备注
101,张三,研发部,18500,"核心骨干，负责架构设计"
102,李四,"市场部, 华东区",14200,"业绩突出"
103,王五,设计部,12000,"擅长UI/UX
曾获年度设计奖"
104,赵六,运营部,9800,"熟练掌握""增长黑客""方法论"
105,钱七,研发部,21000,"前端主程"`

  it('1. 能够正确自适应探测并解析复杂真实 CSV 文本', () => {
    const dataset = CsvDataset.parse(sampleCsvText)

    expect(dataset.delimiter).toBe(',')
    expect(dataset.columnCount).toBe(5)
    expect(dataset.rowCount).toBe(5)
    expect(dataset.headers).toEqual(['ID', '姓名', '部门', '薪资', '备注'])

    // 验证带逗号字段正确解析（未被误切分）
    expect(dataset.getCell(1, 2)).toBe('市场部, 华东区')
    // 验证带多行换行字段正确保留换行
    expect(dataset.getCell(2, 4)).toContain('擅长UI/UX\n曾获年度设计奖')
    // 验证双引号转义 "" 还原为单个 "
    expect(dataset.getCell(3, 4)).toBe('熟练掌握"增长黑客"方法论')
  })

  it('2. 能够正确支持查（全文检索与多类型列排序）', () => {
    const dataset = CsvDataset.parse(sampleCsvText)

    // 全文检索
    const searchResults = dataset.search('研发')
    expect(searchResults).toHaveLength(2)
    expect(searchResults.map((r) => r.rowIndex)).toEqual([0, 4])

    // 按数值列降序排序（薪资：21000 -> 18500 -> 14200 -> 12000 -> 9800）
    dataset.sortBy(3, 'desc')
    expect(dataset.getCell(0, 1)).toBe('钱七')
    expect(dataset.getCell(0, 3)).toBe('21000')
    expect(dataset.getCell(4, 1)).toBe('赵六')
    expect(dataset.getCell(4, 3)).toBe('9800')

    // 按文本列升序排序
    dataset.sortBy(0, 'asc')
    expect(dataset.getCell(0, 0)).toBe('101')
    expect(dataset.getCell(4, 0)).toBe('105')
  })

  it('3. 能够正确支持增（插入行与插入列）', () => {
    const dataset = CsvDataset.parse(sampleCsvText)

    // 在指定索引插入新列（入职状态）
    const colIdx = dataset.insertColumn(4, '入职状态', '在职')
    expect(colIdx).toBe(4)
    expect(dataset.columnCount).toBe(6)
    expect(dataset.headers[4]).toBe('入职状态')
    expect(dataset.getCell(0, 4)).toBe('在职')

    // 插入新员工行
    const rowIdx = dataset.insertRow(2, ['106', '孙八', '测试部', '11500', '试用期', '自动化测试专员'])
    expect(dataset.rowCount).toBe(6)
    expect(dataset.getCell(2, 1)).toBe('孙八')
    expect(dataset.getCell(2, 2)).toBe('测试部')
  })

  it('4. 能够正确支持改（修改单元格与重命名列）', () => {
    const dataset = CsvDataset.parse(sampleCsvText)

    // 修改单元格薪资
    const okCell = dataset.updateCell(0, 3, '20000')
    expect(okCell).toBe(true)
    expect(dataset.getCell(0, 3)).toBe('20000')

    // 重命名表头列名
    const okHeader = dataset.renameColumn(3, '基本薪资(元)')
    expect(okHeader).toBe(true)
    expect(dataset.headers[3]).toBe('基本薪资(元)')
  })

  it('5. 能够正确支持删（删除行与删除列）', () => {
    const dataset = CsvDataset.parse(sampleCsvText)

    // 删除第 2 行（李四）
    const okRow = dataset.deleteRow(1)
    expect(okRow).toBe(true)
    expect(dataset.rowCount).toBe(4)
    expect(dataset.getCell(1, 1)).toBe('王五')

    // 删除备注列
    const okCol = dataset.deleteColumn(4)
    expect(okCol).toBe(true)
    expect(dataset.columnCount).toBe(4)
    expect(dataset.headers).toEqual(['ID', '姓名', '部门', '薪资'])
  })

  it('6. 经过完整的增删改查后，能够无损序列化并再次解析闭环', () => {
    const dataset = CsvDataset.parse(sampleCsvText)

    // 执行一系列增删改
    dataset.insertRow(0, ['100', '周总', '总经办', '50000', '公司负责人，全面统筹'])
    dataset.updateCell(1, 3, '19000') // 张三涨薪
    dataset.deleteRow(4) // 删除赵六
    dataset.insertColumn(2, '职级', 'P6')

    // 导出序列化文本
    const exportedText = dataset.serialize()
    expect(typeof exportedText).toBe('string')

    // 重新解析验证一致性
    const reloaded = CsvDataset.parse(exportedText)
    expect(reloaded.rowCount).toBe(5)
    expect(reloaded.columnCount).toBe(6)
    expect(reloaded.getCell(0, 1)).toBe('周总')
    expect(reloaded.getCell(0, 2)).toBe('P6')
    expect(reloaded.getCell(0, 5)).toBe('公司负责人，全面统筹')
    expect(reloaded.getCell(1, 4)).toBe('19000')
  })

  it('7. 能够正确解析 TSV (Tab 分隔符) 格式', () => {
    const tsvText = "ID\tProduct\tPrice\n1\tMacBook\t9999\n2\tThinkPad\t7999"
    const dataset = CsvDataset.parse(tsvText)
    expect(dataset.delimiter).toBe('\t')
    expect(dataset.headers).toEqual(['ID', 'Product', 'Price'])
    expect(dataset.rowCount).toBe(2)
    expect(dataset.getCell(1, 1)).toBe('ThinkPad')
  })

  it('8. 能够自动探测并剥离 UTF-8 BOM 头(\\uFEFF)', () => {
    const csvWithBom = '\uFEFFID,姓名\n101,张三'
    const dataset = CsvDataset.parse(csvWithBom)
    expect(dataset.headers).toEqual(['ID', '姓名'])
  })
})

describe('JSON 真实文本树形模型集成测试（解析、增删改查与序列化闭环）', () => {
  // 真实应用配置文件样本
  const sampleJsonText = `{
  "app": "Montree",
  "version": "0.4.7",
  "server": {
    "host": "127.0.0.1",
    "port": 39281,
    "ssl": false
  },
  "features": [
    { "name": "markdown-editor", "enabled": true },
    { "name": "pdf-reader", "enabled": true },
    { "name": "ai-copilot", "enabled": false, "quota": 500 }
  ],
  "preferences": {
    "theme": "dark",
    "fontSize": 14,
    "extra": null
  }
}`

  it('1. 能够构建清晰完整的 JSON 树形节点模型', () => {
    const model = JsonTreeModel.parse(sampleJsonText)
    expect(model.tree).not.toBeNull()
    expect(model.tree?.type).toBe('object')
    expect(model.tree?.children).toHaveLength(5)

    // 验证深度路径与数据类型
    const appNode = model.tree?.children?.find((c) => c.key === 'app')
    expect(appNode?.type).toBe('string')
    expect(appNode?.value).toBe('Montree')

    const featuresNode = model.tree?.children?.find((c) => c.key === 'features')
    expect(featuresNode?.type).toBe('array')
    expect(featuresNode?.childCount).toBe(3)
  })

  it('2. 能够正确支持查（JSONPath 寻址与多级检索）', () => {
    const model = JsonTreeModel.parse(sampleJsonText)

    // 字符串路径与数组路径
    expect(model.getValueByPath('$.app')).toBe('Montree')
    expect(model.getValueByPath('$.server.port')).toBe(39281)
    expect(model.getValueByPath('$.features[1].name')).toBe('pdf-reader')
    expect(model.getValueByPath(['preferences', 'fontSize'])).toBe(14)
    expect(model.getValueByPath('$.preferences.extra')).toBeNull()

    // 模糊检索
    const results = model.search('dark')
    expect(results).toHaveLength(1)
    expect(results[0].pathString).toBe('$.preferences.theme')
  })

  it('3. 能够正确支持改（更新数值、对象键重命名）', () => {
    const model = JsonTreeModel.parse(sampleJsonText)

    // 更新端口与版本号
    model.updateValueByPath('$.server.port', 40000)
    model.updateValueByPath('$.version', '0.5.0')
    expect(model.getValueByPath('$.server.port')).toBe(40000)
    expect(model.getValueByPath('$.version')).toBe('0.5.0')

    // 更新数组内部属性
    model.updateValueByPath('$.features[2].enabled', true)
    expect(model.getValueByPath('$.features[2].enabled')).toBe(true)

    // 重命名键
    const renamed = model.renameKey('$.preferences', 'fontSize', 'editorFontSize')
    expect(renamed).toBe(true)
    expect(model.getValueByPath('$.preferences.fontSize')).toBeUndefined()
    expect(model.getValueByPath('$.preferences.editorFontSize')).toBe(14)
  })

  it('4. 能够正确支持增（对象添加属性与数组追加项）', () => {
    const model = JsonTreeModel.parse(sampleJsonText)

    // 给 server 添加 timeout
    model.insertProperty('$.server', 'timeout', 5000)
    expect(model.getValueByPath('$.server.timeout')).toBe(5000)

    // 给 features 数组追加新功能
    model.appendItem('$.features', { name: 'tts-stream', enabled: true })
    expect(model.getValueByPath('$.features[3].name')).toBe('tts-stream')
  })

  it('5. 能够正确支持删（按路径删除属性与数组元素）', () => {
    const model = JsonTreeModel.parse(sampleJsonText)

    // 删除 preferences.extra
    model.deleteByPath('$.preferences.extra')
    expect(model.getValueByPath('$.preferences.extra')).toBeUndefined()

    // 删除 features 数组第 0 项
    model.deleteByPath('$.features[0]')
    expect(model.getValueByPath('$.features[0].name')).toBe('pdf-reader')
  })

  it('6. 具备尾随逗号与单引号的容错解析能力并能序列化回盘', () => {
    const sloppyJson = `{
      'name': 'OpenCode',
      'tools': ['mcp', 'terminal',],
    }`
    const model = JsonTreeModel.parse(sloppyJson)
    expect(model.getValueByPath('$.name')).toBe('OpenCode')
    expect(model.getValueByPath('$.tools[0]')).toBe('mcp')

    const formatted = model.serialize(2)
    expect(formatted).toContain('"name": "OpenCode"')
  })
})

describe('LOG 真实日志流集成测试（级别推断、时间戳与堆栈跟踪解析与过滤）', () => {
  // 真实桌面应用运行时日志样本
  const sampleLogText = `2026-10-10 02:10:01.120 [acp] INFO: Starting ACP connection to runtime 'codex'
2026-10-10 02:10:01.450 [acp] DEBUG: Received initialize response with 14 tools
2026-10-10 02:10:02.010 [TTS] WARN: Rate limit approaching for key 'primary' (12/15 RPM)
2026-10-10 02:10:03.500 [pdf-ocr] ERROR: Failed to render page 14
    at PdfDocument.renderPage (d:\\src\\pdf.ts:120:15)
    at async OcrQueue.processNext (d:\\src\\ocr.ts:88:9)
    Caused by: OutOfMemoryError: Worker heap exhausted
2026-10-10 02:10:04.100 [sync] INFO: Sync completed successfully, 0 conflicts`

  it('1. 能够正确提取级别、时间戳、模块并吸附多行错误堆栈', () => {
    const dataset = LogDataset.parse(sampleLogText)
    expect(dataset.totalCount).toBe(8)

    const stats = dataset.getStats()
    expect(stats.infoCount).toBe(2)
    expect(stats.debugCount).toBe(1)
    expect(stats.warnCount).toBe(1)
    // 错误行 + 3 行堆栈均继承为 error 级别
    expect(stats.errorCount).toBe(4)

    // 检查具体条目
    const errEntry = dataset.entries[3]
    expect(errEntry.level).toBe('error')
    expect(errEntry.module).toBe('pdf-ocr')
    expect(errEntry.timestamp).toBe('2026-10-10 02:10:03.500')
    expect(errEntry.isStackTrace).toBe(false)

    // 堆栈行继承检查
    const stackEntry = dataset.entries[4]
    expect(stackEntry.isStackTrace).toBe(true)
    expect(stackEntry.level).toBe('error')
    expect(stackEntry.module).toBe('pdf-ocr')
  })

  it('2. 能够按级别掩码与正则表达式多维过滤', () => {
    const dataset = LogDataset.parse(sampleLogText)

    // 仅查看警告和错误
    const issues = dataset.filter({ levels: ['error', 'warn'] })
    expect(issues).toHaveLength(5)

    // 正则关键字搜索
    const ttsLogs = dataset.filter({ searchQuery: 'TTS', caseSensitive: false })
    expect(ttsLogs).toHaveLength(1)
    expect(ttsLogs[0].message).toContain('Rate limit approaching')

    // 堆栈错误关键字过滤
    const oom = dataset.filter({ searchQuery: 'OutOfMemory', caseSensitive: false })
    expect(oom).toHaveLength(1)
  })

  it('3. 能够支持增删改日志操作', () => {
    const dataset = LogDataset.parse(sampleLogText)

    // 追加新日志
    const added = dataset.appendLine('2026-10-10 02:11:00.000 [system] INFO: Application shutdown initiated')
    expect(added.level).toBe('info')
    expect(dataset.totalCount).toBe(9)

    // 删除特定行
    dataset.deleteLine(2) // 删除 DEBUG 行
    expect(dataset.getStats().debugCount).toBe(0)

    // 更新日志行
    dataset.updateLine(3, '2026-10-10 02:10:02.010 [TTS] INFO: Quota recovered')
    expect(dataset.entries.find((e) => e.lineIndex === 3)?.level).toBe('info')
  })

  it('4. 能够智能吸附非缩进的异常类行并继承前一行的错误上下文', () => {
    const rawWithNonIndentedException = `2026-10-10 02:15:11.450 [worker-1] ERROR Uncaught Exception
java.lang.OutOfMemoryError: Java heap space
    at com.montree.indexer.process(indexer.ts:185)
2026-10-10 02:15:12.000 [system] INFO Restart completed`

    const ds = LogDataset.parse(rawWithNonIndentedException)
    const errs = ds.filter({ levels: ['error'] })
    expect(errs).toHaveLength(3)
    expect(errs[1].rawText).toContain('OutOfMemoryError')
    expect(errs[1].level).toBe('error')
    expect(errs[1].module).toBe('worker-1')
  })
})


