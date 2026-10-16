// Deterministic ACP peer. No model/network calls except this window's local MCP endpoint.
const readline = require('node:readline')
const { spawn } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
async function mcpRequest(mcp, method, params) {
  if (mcp.type === 'http') {
    const response = await fetch(mcp.url, { method: 'POST', headers: Object.fromEntries([...mcp.headers.map((header) => [header.name, header.value]), ['Content-Type', 'application/json']]), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return response.json()
  }
  return new Promise((resolve, reject) => {
    const child = spawn(mcp.command, mcp.args, { env: { ...process.env, ...Object.fromEntries(mcp.env.map((entry) => [entry.name, entry.value])) }, stdio: 'pipe', windowsHide: true })
    const timer = setTimeout(() => { child.kill(); reject(new Error('MCP stdio timeout')) }, 10000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => { clearTimeout(timer); if (code) reject(new Error('MCP child exited')) })
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      clearTimeout(timer)
      child.stdin.end()
      resolve(JSON.parse(line))
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n')
  })
}
const sessions = new Map()
const permissions = new Map()
const waiting = new Map()
let sequence = 0, requestSequence = 1000
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const result = (id, value) => send({ id, result: value })
const text = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } } } })
const config = (value = 'default') => process.env.E2E_ACP_COMPOSER_TEST === '1' ? [
  { id: 'fast_mode', name: 'Fast mode', type: 'boolean', currentValue: false },
  { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'auto', options: [{ value: 'auto', name: 'Auto review' }, { value: 'manual', name: 'Manual review' }] },
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'gpt-test', options: [{ value: 'gpt-test', name: '6 Luna' }] },
  { id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select', currentValue: 'medium', options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }] },
] : [{ id: 'mode', name: 'Mode', type: 'select', currentValue: value, options: [{ value: 'default', name: 'Default' }, { value: 'alternate', name: 'Alternate' }] }]
const request = (method, params) => new Promise((resolve) => {
  const id = ++requestSequence
  permissions.set(id, resolve)
  send({ id, method, params })
})
async function handle(message) {
  const { id, method, params = {} } = message
  if (!method) { permissions.get(id)?.(message.result); permissions.delete(id); return }
  if (method === 'initialize') {
    result(id, { protocolVersion: 1, agentInfo: { name: 'mock-window', version: '1' }, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, promptCapabilities: { image: true } }, authMethods: [] })
  } else if (method === 'session/new' || method === 'session/load' || method === 'session/resume') {
    const sessionId = params.sessionId || `mock-${process.pid}-${++sequence}`
    sessions.set(sessionId, { cwd: params.cwd, mcp: params.mcpServers?.[0] })
    const recoveryFile = process.env.E2E_ACP_TOOL_RECOVERY_FILE
    const ids = params._meta?.toolOutputRecovery?.toolCallIds
    const outputs = recoveryFile && existsSync(recoveryFile) && Array.isArray(ids) ? JSON.parse(readFileSync(recoveryFile, 'utf8')).filter(row => ids.includes(row.toolCallId)) : []
    result(id, { sessionId, configOptions: config(), ...(outputs.length ? {_meta:{toolOutputRecovery:{outputs}}} : {}) })
  } else if (method === 'session/prompt') {
    const sessionId = params.sessionId
    // 产品 sendPrompt 会在用户块前拼接 bootstrap/turn-context 块（真实模型透明）；
    // mock 取最后一个非空文本块作命令，避免前缀污染精确匹配。
    const blocks = Array.isArray(params.prompt) ? params.prompt : []
    let command = ''
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const text = blocks[i] && blocks[i].text
      if (typeof text === 'string' && text.trim()) {
        command = text.trim()
        break
      }
    }
    if (!command) command = blocks.map((block) => block.text || '').join('') || ''
    if (command === 'wait') {
      waiting.set(sessionId, id)
      text(sessionId, `WAIT:${sessionId}`)
      return
    }
    let output = command
    if (command === 'recover-empty-tool') {
      send({method:'session/update',params:{sessionId,update:{sessionUpdate:'tool_call',toolCallId:'agy-t1-s17',title:'Call Mcp Tool',status:'in_progress'}}})
      send({method:'session/update',params:{sessionId,update:{sessionUpdate:'tool_call_update',toolCallId:'agy-t1-s17',status:'completed',content:[]}}})
      output = 'EMPTY_TOOL_SAVED'
    }
    if (command.includes('[react-artifact-submit ') || command.includes('[react-artifact-repair ')) output = `ARTIFACT_REPLY:${sessionId}|${command}`
    if (command === 'identity') {
      output = `IDENTITY:${sessionId}|${sessions.get(sessionId).cwd}`
    } else if (command.startsWith('diagram:') || command === 'inline-diagram') {
      const diagramType = command === 'inline-diagram' ? 'flowchart' : command.slice('diagram:'.length)
      const { mcp } = sessions.get(sessionId)
      const guide = await mcpRequest(mcp, 'tools/call', { name: 'montree_diagram_guide', arguments: { diagramType } })
      if (guide.result?.isError) throw new Error('diagram guide failed')
      // 模拟模型输出纯参数；MCP 生成 HTML/SVG 的链路与生产一致。
      let nodes = diagramType === 'flowchart' ? [
        { id: 'start', label: '开始', kind: 'start', layer: 0 },
        { id: 'check', label: '内容已准备好？', kind: 'decision', layer: 1, details: '检查文档与工具是否就绪' },
        { id: 'done', label: '展示图解', kind: 'end', layer: 2 },
        { id: 'retry', label: '重新加载', layer: 2 },
      ] : [
        { id: 'reader', label: '读者', details: '</script><script>window.injected=1</script>' },
        { id: 'agent', label: '助手' }, { id: 'host', label: 'Montree' },
      ]
      let edges = diagramType === 'flowchart' ? [
        { from: 'start', to: 'check', label: '读取' }, { from: 'check', to: 'done', label: '是' },
        { from: 'check', to: 'retry', label: '否' }, { from: 'retry', to: 'check', label: '重试' },
      ] : [{ from: 'reader', to: 'agent', label: '请求图解' }, { from: 'agent', to: 'host', label: '提交参数' }, ...(diagramType === 'sequence' ? [{ from: 'host', to: 'agent', label: '返回 SVG', reply: true }] : [])]
      let lanes
      if (diagramType === 'mindmap') {
        nodes.push({ id: 'reading', label: '阅读方法' }, { id: 'notes', label: '批注整理' })
        edges = [{ from: 'reader', to: 'agent' }, { from: 'reader', to: 'host' }, { from: 'agent', to: 'reading' }, { from: 'agent', to: 'notes' }]
      } else if (diagramType === 'swimlane') {
        lanes = [{ id: 'user', label: '用户' }, { id: 'system', label: '软件' }]
        nodes = nodes.map((node, i) => ({ ...node, lane: i === 0 ? 'user' : 'system', layer: i }))
      } else if (diagramType === 'timeline') {
        nodes = nodes.map((node, i) => ({ ...node, when: ['第一阶段', '第二阶段', '第三阶段'][i] }))
      } else if (diagramType === 'cycle') {
        edges.push({ from: 'host', to: 'reader', label: '反馈学习' })
      } else if (diagramType === 'fishbone') {
        nodes.push({ id: 'method', label: '阅读方法' }, { id: 'practice', label: '持续练习' })
        edges = [{ from: 'reader', to: 'host' }, { from: 'agent', to: 'host' }, { from: 'method', to: 'reader' }, { from: 'practice', to: 'agent' }]
      } else if (diagramType === 'er') {
        nodes = nodes.map((node, i) => ({ ...node, fields: [{ name: 'id', type: 'UUID', key: 'PK', details: '实体唯一标识' }, ...(i ? [{ name: i === 1 ? 'reader_id' : 'agent_id', type: 'UUID', key: 'FK' }] : [{ name: 'name', type: 'TEXT' }])] }))
        edges = edges.map((edge, i) => ({ ...edge, fromCardinality: '1', toCardinality: '0..*', fromField: 'id', toField: i === 0 ? 'reader_id' : 'agent_id' }))
      }
      const toolCallId = `diagram-${sessionId}-${++sequence}`
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: 'mcp.montree.montree_present', kind: 'execute', status: 'in_progress' } } })
      const rpc = await mcpRequest(mcp, 'tools/call', { name: 'montree_present', arguments: { kind: 'preset', preset: 'diagram', diagramType, title: `内置${diagramType}`, nodes, edges, ...(lanes ? { lanes } : {}) } })
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: rpc.result?.isError ? 'failed' : 'completed', rawOutput: { result: rpc.result, error: null } } } })
      if (command === 'inline-diagram') {
        const payload = JSON.parse(rpc.result.content[0].text)
        text(sessionId, ['正文前段：先理解整体流程。', '', '```montree-present', payload.id, '```', '', '正文后段：然后查看节点详情。', '', '```montree-present', payload.id, '```'].join('\n'))
        if (process.env.E2E_ACP_STREAM_GATE) {
          const deadline = Date.now() + 30000
          while (!existsSync(process.env.E2E_ACP_STREAM_GATE)) {
            if (Date.now() > deadline) throw new Error('inline gate timeout')
            await new Promise(resolve => setTimeout(resolve, 20))
          }
        }
        output = ''
      } else output = `SVG:${sessionId}|${diagramType}`
    } else if (command === 'tools') {
      const { mcp } = sessions.get(sessionId)
      const rpc = await mcpRequest(mcp, 'tools/list')
      output = `TOOLS:${sessionId}|${rpc.result.tools.map((tool) => tool.name).join(',')}`
    } else if (command === 'read') {
      const { mcp, cwd } = sessions.get(sessionId)
      const rpc = await mcpRequest(mcp, 'tools/call', { name: 'montree_read', arguments: { scope: 'viewport' } })
      output = `READ:${sessionId}|${cwd}|${rpc.result?.content?.[0]?.text}`
    } else if (command === 'permission') {
      const answer = await request('session/request_permission', { sessionId, toolCall: { toolCallId: `tool-${sessionId}`, title: `Permission ${sessionId}` }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
      output = `PERMISSION:${sessionId}|${answer.outcome.outcome}|${answer.outcome.optionId || ''}`
    } else if (command.startsWith('present-raw-echo:')) {
      const result = JSON.parse(command.slice('present-raw-echo:'.length))
      const toolCallId = `present-${sessionId}-${++sequence}`
      // codex-acp 2.2.2：开始含标题，完成仅在 rawOutput.result 返回 MCP 原始结果。
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title: 'mcp.montree.montree_present', kind: 'execute', status: 'in_progress' } } })
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed', rawOutput: { result, error: null } } } })
      output = `RAW_ECHO:${sessionId}`
    } else if (command.startsWith('present-echo:')) {
      // 回放一次真实工具结果（由测试经 MCP tools/call 取得）：只做透传，不编造。
      const payload = JSON.parse(command.slice('present-echo:'.length))
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: `present-${sessionId}`, title: 'montree_present', kind: 'other', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(payload) } }] } } })
      output = `ECHO:${sessionId}|${payload.id}`
    } else if (command === 'worklog') {
      for (const [toolCallId, title, kind] of [['worklog-a', 'read_text_file', 'read'], ['worklog-b', 'search', 'search']]) {
        send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId, title, kind, status: 'in_progress' } } })
      }
      const deadline = Date.now() + 30000
      while (process.env.E2E_WORKLOG_GATE && !existsSync(process.env.E2E_WORKLOG_GATE)) {
        if (Date.now() > deadline) throw new Error('worklog gate timeout')
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      for (const toolCallId of ['worklog-a', 'worklog-b']) {
        send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' } } })
      }
      output = `WORKLOG:${sessionId}|done`
    } else if (command === 'stream') {      const parts = ['# 流式报告\n\n首段中文正文。\n\n', '表格如下：\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n\n', '```ts\nconst answer = 42\n```\n\n', '公式 $2x+1$ 与 [链接](https://example.com/a)。\n\n', '```mermaid\ngraph TD; A-->B\n```\n\n尾段收束。脚注[^1]\n\n[^1]: 脚注证据内容']
      for (const part of parts) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        text(sessionId, part)
        if (part === parts[0] && process.env.E2E_ACP_STREAM_GATE) {
          // 首段中间态由测试确认后再续流，避免慢 CI 的懒加载吞掉观察窗口。
          const deadline = Date.now() + 30000
          while (!existsSync(process.env.E2E_ACP_STREAM_GATE)) {
            if (Date.now() > deadline) throw new Error('stream gate timeout')
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
        }
      }
      output = `STREAM:${sessionId}|done`
    } else if (command === 'status-flow') {
      // 给状态 UI 一个可观察的等待窗口；思考只来自此真实协议事件。
      await new Promise((resolve) => setTimeout(resolve, 2000))
      send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先检查当前文档证据。' } } } })
      await new Promise((resolve) => setTimeout(resolve, 1600))
      text(sessionId, '已完成证据核对。')
      output = `STATUS:${sessionId}|done`
    } else if (command === 'rich-check') {
      // 富文本核验单：高亮/上标/脚注/公式/折叠/任务列表/kbd，一次回放，不编造。
      text(sessionId, '高亮 ==标记== 与 ^上标^。\n\n注脚[^7]\n\n[^7]: 注脚正文\n\n行内公式 $E=mc^2$。\n\n<details><summary>点我展开</summary>里面是细节</details>\n\n- [x] 已做\n- [ ] 待做\n\n按 <kbd>Ctrl</kbd>+<kbd>K</kbd>')
      output = `RICH:${sessionId}|done`
    }
    text(sessionId, output)
    result(id, { stopReason: 'end_turn' })
  } else if (method === 'session/cancel') {
    const pending = waiting.get(params.sessionId)
    if (pending != null) { waiting.delete(params.sessionId); result(pending, { stopReason: 'cancelled' }) }
  } else if (method === 'session/set_config_option') {
    result(id, { configOptions: config(params.value) })
  } else if (id != null) {
    send({ id, error: { code: -32601, message: method } })
  }
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  try { void handle(JSON.parse(line)).catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1 }) }
  catch (error) { process.stderr.write(error.stack + '\n') }
})
