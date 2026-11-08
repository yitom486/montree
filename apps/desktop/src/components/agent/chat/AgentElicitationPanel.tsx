import { useId, useRef, useState } from 'react'
import { OptionList } from '@/components/assistant-ui/elements/option-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAcpUiStore } from '@/stores/acp-ui-store'
import { useElicitationStore, type PendingElicitation } from '@/stores/acp/elicitation-store'
import { respondToElicitation } from '@/hooks/agent/useAcpElicitationIngest'
import { elicitationOptions, validateElicitationContent, type ElicitationContent, type ElicitationField, type ElicitationResponse } from '../../../../contracts/acp-elicitation'

function initialContent(request: PendingElicitation): ElicitationContent {
  return Object.fromEntries(Object.entries(request.schema.properties ?? {}).flatMap(([key, field]) => field.default == null ? [] : [[key, field.default]]))
}

function ElicitationForm({ request }: { request: PendingElicitation }) {
  const id = useId()
  const [content, setContent] = useState(() => initialContent(request))
  const [error, setError] = useState<string>()
  const [revisions, setRevisions] = useState<Record<string, number>>({})
  const errorRef = useRef<HTMLParagraphElement>(null)
  const setValue = (key: string, value: ElicitationContent[string] | undefined) => {
    setContent(previous => {
      const next = { ...previous }
      if (value === undefined) delete next[key]
      else Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true })
      return next
    })
    setError(undefined)
  }
  const respond = async (response: ElicitationResponse) => {
    if (response.action === 'accept') {
      const invalid = validateElicitationContent(request.schema, response.content)
      if (invalid) { setError(invalid); requestAnimationFrame(() => errorRef.current?.focus()); return }
    }
    try { await respondToElicitation(request.id, response) } catch (cause) { setError(cause instanceof Error ? cause.message : '提交失败，请重试') }
  }
  const renderField = (key: string, field: ElicitationField, index: number) => {
    const fieldId = `${id}-${index}`
    const options = elicitationOptions(field)
    const value = content[key]
    const required = request.schema.required?.includes(key)
    return (
      <div key={key} className="min-w-0 space-y-2">
        <Label id={`${fieldId}-label`} htmlFor={fieldId} className="text-sm font-medium">
          {field.title || key}{required ? '（必填）' : ''}
        </Label>
        {field.description ? <p id={`${fieldId}-description`} className="text-sm text-secondary-foreground">{field.description}</p> : null}
        {options ? <>
          <OptionList
            key={`${key}-${revisions[key] ?? 0}`}
            aria-labelledby={`${fieldId}-label`}
            aria-describedby={field.description ? `${fieldId}-description` : undefined}
            className="max-w-full rounded-lg bg-card"
            options={options.map(option => ({ id: option.const, label: option.title, description: option.description ?? undefined, disabled: request.submitting }))}
            selectionMode={field.type === 'array' ? 'multiple' : 'single'}
            defaultValue={Array.isArray(value) ? value : typeof value === 'string' ? [value] : undefined}
            minSelections={field.minItems ?? 0}
            maxSelections={field.maxItems ?? undefined}
            confirmLabel="确认选择"
            onConfirm={ids => setValue(key, field.type === 'array' ? ids : ids[0])}
          />
          <Button type="button" variant="ghost" size="sm" disabled={request.submitting} onClick={() => {
            setValue(key, undefined)
            setRevisions(previous => ({ ...previous, [key]: (previous[key] ?? 0) + 1 }))
          }}>重新选择</Button>
        </> : field.type === 'boolean' ? <div className="flex items-center gap-2">
          <Checkbox id={fieldId} checked={value === true} disabled={request.submitting} onCheckedChange={checked => setValue(key, checked === true)} />
          <Label htmlFor={fieldId} className="text-sm">是</Label>
          {value === undefined ? <Button type="button" variant="ghost" size="sm" disabled={request.submitting} onClick={() => setValue(key, false)}>选择否</Button> : null}
        </div> : <Input
          id={fieldId}
          name={key}
          autoComplete="off"
          spellCheck={field.format === 'email' || field.format === 'uri' ? false : undefined}
          aria-describedby={field.description ? `${fieldId}-description` : undefined}
          aria-required={required}
          className="h-10 text-sm"
          type={field.type === 'number' || field.type === 'integer' ? 'number' : field.format === 'email' ? 'email' : field.format === 'date' ? 'date' : field.format === 'uri' ? 'url' : 'text'}
          step={field.type === 'integer' ? 1 : 'any'}
          min={field.minimum ?? undefined} max={field.maximum ?? undefined}
          minLength={field.minLength ?? undefined} maxLength={field.maxLength ?? undefined}
          placeholder={field.format === 'date-time' ? '例如 2026-11-08T12:00:00+08:00…' : undefined}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          disabled={request.submitting}
          onChange={event => setValue(key, event.target.value === '' ? required && field.type === 'string' && !field.minLength ? '' : undefined : field.type === 'number' || field.type === 'integer' ? Number(event.target.value) : event.target.value)}
        />}
      </div>
    )
  }
  return <Card className="min-w-0 gap-4 rounded-xl py-4 shadow-sm" aria-labelledby={`${id}-title`}>
    <CardHeader className="gap-2 px-4">
      <CardTitle id={`${id}-title`} className="text-sm font-semibold leading-relaxed whitespace-pre-wrap break-words">{request.message}</CardTitle>
      {request.schema.title ? <CardDescription className="text-sm">{request.schema.title}</CardDescription> : null}
      {request.schema.description ? <CardDescription className="text-sm">{request.schema.description}</CardDescription> : null}
    </CardHeader>
    <form noValidate onSubmit={event => { event.preventDefault(); void respond({ action: 'accept', content }) }}>
      <CardContent className="space-y-4 px-4">
        <fieldset disabled={request.submitting} className="min-w-0 space-y-4">
          {Object.entries(request.schema.properties ?? {}).map(([key, field], index) => renderField(key, field, index))}
        </fieldset>
        {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-sm text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring">{error}</p> : null}
      </CardContent>
      <CardFooter className="mt-4 flex flex-wrap gap-2 px-4">
        <Button type="submit" size="sm" disabled={request.submitting}>{request.submitting ? '提交中…' : '提交回答'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={request.submitting} onClick={() => void respond({ action: 'decline' })}>拒绝回答</Button>
        <Button type="button" size="sm" variant="ghost" disabled={request.submitting} onClick={() => void respond({ action: 'cancel' })}>取消</Button>
      </CardFooter>
    </form>
  </Card>
}

/** Shared by docked and floating chat; one host-owned request can only settle once. */
export function AgentElicitationPanel() {
  const threadId = useAcpUiStore(state => state.activeThreadId)
  const requests = useElicitationStore(state => state.pending)
  const receipts = useElicitationStore(state => state.receipts)
  const pending = requests.filter(item => item.threadId === threadId)
  const receipt = receipts.findLast(item => item.request.threadId === threadId)
  if (!pending.length && !receipt) return null
  return <section aria-label="助手提问" className="max-h-96 shrink overflow-y-auto px-3 py-2">
    <div className="mx-auto w-full max-w-prose space-y-4">
      {pending.map(request => <ElicitationForm key={request.id} request={request} />)}
      {!pending.length && receipt ? <Card className="gap-2 rounded-xl p-4 shadow-sm">
        <p className="text-sm font-medium break-words">{receipt.request.message}</p>
        <p role="status" className="text-sm text-secondary-foreground break-words">
          {receipt.response?.action === 'accept' ? `已回答：${Object.entries(receipt.response.content).map(([key, value]) => {
            const field = receipt.request.schema.properties?.[key]
            const options = field ? elicitationOptions(field) : undefined
            const label = (text: string) => options?.find(option => option.const === text)?.title ?? text
            return `${field?.title || key}：${Array.isArray(value) ? value.map(label).join('、') : typeof value === 'boolean' ? value ? '是' : '否' : label(String(value))}`
          }).join('；')}` : receipt.response?.action === 'decline' ? '已拒绝回答' : '提问已取消或结束'}
        </p>
      </Card> : null}
    </div>
  </section>
}
