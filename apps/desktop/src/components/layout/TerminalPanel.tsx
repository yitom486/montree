import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardPaste, Plus, Trash2, X } from 'lucide-react'
import { terminalApi } from '@/api/terminal-api'
import type { TerminalInfo, TerminalProfile, TerminalEvent } from '../../../contracts/terminal'
import '@xterm/xterm/css/xterm.css'

function TerminalSurface({ terminal, active, onError }: { terminal: TerminalInfo; active: boolean; onError: (message: string) => void }) {
  const element = useRef<HTMLDivElement>(null)
  const viewRef = useRef<{ focus: () => void } | null>(null)
  const activeRef = useRef(active); activeRef.current = active
  useEffect(() => { if (active) viewRef.current?.focus() }, [active])
  useEffect(() => {
    let disposed = false
    let release = () => {}
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
      if (disposed || !element.current) return
      const view = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, "Cascadia Code", monospace', scrollback: 3000,
        theme: { background: '#111318', foreground: '#e5e7eb', cursor: '#e5e7eb', selectionBackground: '#385579' } })
      const fit = new FitAddon(); view.loadAddon(fit); view.open(element.current)
      viewRef.current = view
      let cursor = 0, ready = false
      const queued: Extract<TerminalEvent, { type: 'data' }>[] = []
      const write = (data: string, end: number) => {
        if (end <= cursor) return
        view.write(data.slice(Math.max(0, cursor - (end - data.length)))); cursor = end
      }
      const unsubscribe = terminalApi.onEvent(event => {
        if (!('id' in event) || event.id !== terminal.id) return
        if (event.type === 'data') { if (!ready) queued.push(event); else write(event.data, event.cursor) }
        if (event.type === 'exit') view.write(`\r\n[进程已退出，代码 ${event.exitCode}]\r\n`)
      })
      const input = view.onData(data => { void terminalApi.write(terminal.id, data).then(result => { if (!result.ok && !disposed) onError(result.error.message) }).catch(error => { if (!disposed) onError(String(error)) }) })
      view.attachCustomKeyEventHandler(event => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.type === 'keydown') {
          if (event.code === 'KeyC' && view.hasSelection()) { void navigator.clipboard.writeText(view.getSelection()).catch(error => onError(String(error))); return false }
          if (event.code === 'KeyV') { void navigator.clipboard.readText().then(text => view.paste(text)).catch(error => onError(String(error))); return false }
        }
        return true
      })
      const resize = () => {
        if (element.current && element.current.clientWidth > 0 && element.current.clientHeight > 0) {
          fit.fit(); void terminalApi.resize(terminal.id, view.cols, view.rows).catch(error => { if (!disposed) onError(String(error)) })
        }
      }
      const observer = new ResizeObserver(resize); observer.observe(element.current)
      release = () => { unsubscribe(); input.dispose(); observer.disconnect(); view.dispose(); viewRef.current = null }
      resize()
      const result = await terminalApi.read(terminal.id)
      if (disposed) return
      if (result.ok) { write(result.value.output, result.value.cursor); ready = true; for (const event of queued) write(event.data, event.cursor) }
      else onError(result.error.message)
      if (activeRef.current) view.focus()
    })().catch(error => { if (!disposed) onError(String(error)) })
    return () => { disposed = true; release() }
  }, [terminal.id, onError])
  return <div ref={element} className="h-full min-h-0 px-2 py-1" style={{ display: active ? undefined : 'none' }} aria-label={terminal.title} />
}

export default function TerminalPanel({ visible, workspaceRoot, onClose }: { visible: boolean; workspaceRoot?: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([])
  const [active, setActive] = useState<string>()
  const [profiles, setProfiles] = useState<TerminalProfile[]>([])
  const [profile, setProfile] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const previousRoot = useRef(workspaceRoot)
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions
  const showError = useCallback((message: string) => setError(message), [])
  const merge = useCallback((info: TerminalInfo) => {
    setSessions(current => [...current.filter(row => row.id !== info.id), info]); setActive(info.id)
  }, [])
  const create = async () => {
    setCreating(true); setError('')
    try { const result = await terminalApi.create({ ...(profile ? { profile } : {}) }); if (result.ok) merge(result.value); else showError(result.error.message) }
    catch (failure) { showError(String(failure)) } finally { setCreating(false) }
  }
  useEffect(() => terminalApi.onEvent(event => {
    if (event.type === 'created') merge(event.terminal)
    if (event.type === 'closed') setSessions(current => current.filter(row => row.id !== event.id))
    if (event.type === 'exit') setSessions(current => current.map(row => row.id === event.id ? { ...row, exitCode: event.exitCode } : row))
  }), [merge])
  useEffect(() => {
    let disposed = false
    const old = previousRoot.current !== workspaceRoot ? sessionsRef.current : []
    previousRoot.current = workspaceRoot
    if (old.length) { setSessions([]); setActive(undefined) }
    void (async () => {
      await Promise.allSettled(old.map(row => terminalApi.close(row.id)))
      const [listed, available] = await Promise.all([terminalApi.list(), terminalApi.profiles()])
      if (disposed) return
      if (listed.ok) { setSessions(listed.value); setActive(current => current && listed.value.some(row => row.id === current) ? current : listed.value[0]?.id) }
      if (available.ok) { setProfiles(available.value); setProfile(available.value[0]?.id ?? '') }
      else { setProfiles([]); showError(available.error.message) }
    })().catch(error => { if (!disposed) showError(String(error)) })
    return () => { disposed = true }
  }, [workspaceRoot, showError])
  const selected = sessions.find(row => row.id === active) || sessions[0]
  return <section className="flex h-full min-h-0 flex-col bg-[#111318] text-gray-200" style={{ display: visible ? undefined : 'none' }} aria-label="工作区终端">
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/10 px-2 text-xs">
      <span className="shrink-0">终端</span>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="终端会话">
        {sessions.map(row => <button key={row.id} role="tab" aria-selected={selected?.id === row.id} onClick={() => setActive(row.id)} title={`${row.cwd}${row.exitCode === undefined ? '' : ` · 已退出 (${row.exitCode})`}`} className={`max-w-48 truncate rounded px-2 py-1 ${selected?.id === row.id ? 'bg-white/15' : 'hover:bg-white/5'}`}>{row.title}{row.exitCode === undefined ? '' : ' · 已退出'}</button>)}
      </div>
      <select aria-label="选择 Shell" className="max-w-32 rounded border border-white/15 bg-[#111318] p-1" value={profile} onChange={event => setProfile(event.target.value)}>{profiles.map(row => <option value={row.id} key={row.id}>{row.label}</option>)}</select>
      <button title="新建终端" aria-label="新建终端" disabled={creating || !profiles.length} onClick={() => void create()} className="p-1 disabled:opacity-40"><Plus className="size-4" /></button>
      <button title="粘贴到终端" aria-label="粘贴到终端" disabled={!selected || selected.exitCode !== undefined} onClick={() => { if (selected) void navigator.clipboard.readText().then(text => terminalApi.write(selected.id, text)).catch(error => showError(String(error))) }} className="p-1 disabled:opacity-40"><ClipboardPaste className="size-3.5" /></button>
      <button title="结束并关闭终端" aria-label="结束并关闭终端" disabled={!selected} onClick={() => { if (selected) void terminalApi.close(selected.id).then(result => { if (!result.ok) showError(result.error.message) }).catch(error => showError(String(error))) }} className="p-1 disabled:opacity-40"><Trash2 className="size-3.5" /></button>
      <button title="隐藏终端（保留会话）" aria-label="隐藏终端" onClick={onClose} className="p-1"><X className="size-4" /></button>
    </div>
    {error && <div role="alert" className="shrink-0 bg-red-950/50 px-3 py-1 text-xs text-red-200">{error}</div>}
    <div className="min-h-0 flex-1 overflow-hidden">
      {sessions.map(row => <TerminalSurface key={row.id} terminal={row} active={visible && selected?.id === row.id} onError={showError} />)}
      {!sessions.length && <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-400"><span>{workspaceRoot || '默认用户目录'}</span><button disabled={creating || !profiles.length} className="rounded border border-white/20 px-3 py-1 disabled:opacity-40" onClick={() => void create()}>新建终端</button></div>}
    </div>
  </section>
}
