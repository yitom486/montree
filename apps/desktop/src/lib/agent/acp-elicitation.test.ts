import { describe, expect, it } from 'vitest'
import { validateElicitationContent as validate, validateElicitationSchema, type ElicitationSchema } from '../../../contracts/acp-elicitation'

const schema: ElicitationSchema = {
  properties: {
    choice: { type: 'string', oneOf: [{ const: 'a', title: '甲' }, { const: 'b', title: '乙' }] },
    many: { type: 'array', items: { anyOf: [{ const: 'a', title: '甲' }, { const: 'b', title: '乙' }] }, minItems: 1, maxItems: 2 },
    text: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' },
    count: { type: 'integer', minimum: 1, maximum: 5 },
    flag: { type: 'boolean' },
  }, required: ['choice', 'flag'],
}
describe('ACP form schema and response validation', () => {
  it('supports single/multiple options, text, integers, booleans and omitted optional fields', () => {
    expect(validateElicitationSchema(schema)).toBeUndefined()
    expect(validate(schema, { choice: 'a', flag: false })).toBeUndefined()
    expect(validate(schema, { choice: 'b', flag: true, many: ['a', 'b'], text: 'abc', count: 3 })).toBeUndefined()
  })
  it.each([
    { choice: 'a' }, { choice: 'c', flag: false }, { choice: 'a', flag: 'false' },
    { choice: 'a', flag: true, many: ['a', 'a'] }, { choice: 'a', flag: true, many: [] },
    { choice: 'a', flag: true, count: 1.5 }, { choice: 'a', flag: true, count: 6 },
    { choice: 'a', flag: true, text: '12' }, { choice: 'a', flag: true, unknown: 'x' },
  ])('rejects invalid content %j', content => expect(validate(schema, content as never)).toBeTruthy())
  it('supports all standard string formats and rejects malformed dates', () => {
    const formats: ElicitationSchema = { properties: { email: { type: 'string', format: 'email' }, uri: { type: 'string', format: 'uri' }, date: { type: 'string', format: 'date' }, time: { type: 'string', format: 'date-time' } } }
    expect(validate(formats, { email: 'a@example.com', uri: 'https://example.com', date: '2026-11-08', time: '2026-11-08T12:00:00+08:00' })).toBeUndefined()
    expect(validate(formats, { date: '2026-02-30' })).toBeTruthy()
    expect(validate(formats, { time: '2026-11-08T12:00:00' })).toBeTruthy()
  })
  it('rejects unsupported schemas instead of silently omitting fields', () => {
    expect(validateElicitationSchema({ properties: { x: { type: 'object' } } } as never)).toBeTruthy()
    expect(validateElicitationSchema({ required: ['missing'] })).toBeTruthy()
    expect(validateElicitationSchema({ properties: { x: { type: 'string', pattern: '[' } } })).toBeTruthy()
    expect(validateElicitationSchema({ properties: { x: { type: 'number', default: 'invalid' } } })).toBeTruthy()
  })
})
