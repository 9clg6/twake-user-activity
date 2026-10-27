import { describe, expect, it } from 'vitest'
import { MalformedEventError } from '../../events/errors.ts'
import type { Hit } from '../../product/port.ts'
import { activityHandler, pseudonym } from './handlers.ts'

const PEPPER = 'a-pepper-that-is-at-least-32-characters'

const event = (overrides: Record<string, unknown> = {}) => ({
  specversion: '1.0',
  id: '0192f0c2-0000-7000-8000-000000000001',
  source: 'twake://registration',
  type: 'com.twake.mail.user.active.v1',
  time: '2026-10-24T10:30:00Z',
  twakeactor: 'Alice@Example.com',
  twakeactorid: '6f1c1b5e-0000-4000-8000-000000000001',
  twakeorg: 'org.example.com',
  data: { category: 'background', action: 'email.read', platform: 'desktop' },
  ...overrides
})

function handler() {
  const hits: Hit[] = []
  const warnings: unknown[] = []
  const handle = activityHandler({
    pepper: PEPPER,
    logger: { warn: (fields: unknown) => void warnings.push(fields) },
    track: hit => {
      hits.push(hit)
      return Promise.resolve()
    }
  })
  return { hits, handle, warnings }
}

describe('activityHandler', () => {
  it('turns an activity event into a pseudonymous hit for its app', async () => {
    const { hits, handle } = handler()
    await handle(event())
    expect(hits).toEqual([
      {
        app: 'mail',
        user: pseudonym('alice@example.com', PEPPER),
        time: new Date('2026-10-24T10:30:00Z'),
        category: 'background',
        action: 'email.read',
        tenant: 'org.example.com',
        platform: 'desktop'
      }
    ])
    expect(JSON.stringify(hits)).not.toMatch(/alice/i)
  })

  it('fills the category and action an app left out', async () => {
    const { hits, handle } = handler()
    await handle(event({ data: undefined, twakeorg: undefined }))
    expect(hits[0]).toMatchObject({
      category: 'unclassified',
      action: 'activity'
    })
    expect(hits[0]).not.toHaveProperty('tenant')
    expect(hits[0]).not.toHaveProperty('platform')
    expect(hits[0]).not.toHaveProperty('ip')
  })

  it('passes on the user address the app sent', async () => {
    const { hits, handle } = handler()
    await handle(event({ data: { ip: '203.0.113.7' } }))
    expect(hits[0]).toMatchObject({ ip: '203.0.113.7' })
  })

  it('passes on the properties the app sent', async () => {
    const { hits, handle } = handler()
    const properties = { button: 'send', count: 3, ok: true, note: null }
    await handle(event({ data: { properties } }))
    expect(hits[0]).toMatchObject({ properties })
  })

  it('keeps the event and the valid properties, and logs the dropped keys', async () => {
    const { hits, handle, warnings } = handler()
    await handle(
      event({
        data: {
          properties: {
            good: 'ok',
            nested: { b: 1 },
            list: [1],
            big: Infinity,
            'a-b': 1,
            $ip: '203.0.113.7',
            tenant: 'other',
            ['a'.repeat(65)]: 1,
            long: 'x'.repeat(201)
          }
        }
      })
    )
    expect(hits[0]).toMatchObject({
      action: 'activity',
      properties: { good: 'ok', long: 'x'.repeat(200) }
    })
    expect(Object.keys(hits[0]?.properties ?? {})).toEqual(['good', 'long'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      id: '0192f0c2-0000-7000-8000-000000000001',
      dropped: ['nested', 'list', 'big', 'a-b', '$ip', 'tenant', 'a'.repeat(65)]
    })
    expect(JSON.stringify(warnings)).not.toContain('203.0.113.7')
  })

  it('keeps the first 50 properties', async () => {
    const { hits, handle, warnings } = handler()
    const properties = Object.fromEntries(
      Array.from({ length: 52 }, (_, i) => ['k' + String(i), i])
    )
    await handle(event({ data: { properties } }))
    expect(Object.keys(hits[0]?.properties ?? {})).toHaveLength(50)
    expect(hits[0]?.properties).toHaveProperty('k49')
    expect(hits[0]?.properties).not.toHaveProperty('k50')
    expect(warnings[0]).toMatchObject({ dropped: ['k50', 'k51'] })
  })

  it.each([
    ['a string', 'x'],
    ['an array', [1]],
    ['null', null]
  ])('keeps the event when properties is %s', async (_name, properties) => {
    const { hits, handle, warnings } = handler()
    await handle(event({ data: { properties } }))
    expect(hits).toHaveLength(1)
    expect(hits[0]).not.toHaveProperty('properties')
    expect(warnings).toHaveLength(1)
  })

  it('does not log when there is nothing to drop', async () => {
    const { handle, warnings } = handler()
    await handle(event({ data: { properties: { a: 1 } } }))
    await handle(event())
    expect(warnings).toEqual([])
  })

  it.each([
    ['no time', { time: undefined }],
    ['no actor', { twakeactor: undefined }],
    ['another event type', { type: 'com.twake.mail.user.created.v1' }],
    ['an unknown category', { data: { category: 'idle' } }],
    ['an unknown platform', { data: { platform: 'tv' } }],
    ['an address that is not an IP', { data: { ip: 'example.com' } }],
    ['the reserved billing app', { type: 'com.twake.billing.user.active.v1' }],
    ['not a CloudEvent', { specversion: '0.3' }]
  ])('drops an event with %s', async (_name, overrides) => {
    const { hits, handle } = handler()
    await expect(handle(event(overrides))).rejects.toBeInstanceOf(
      MalformedEventError
    )
    expect(hits).toEqual([])
  })
})

describe('pseudonym', () => {
  it('is the same for one address in any case, and differs per pepper', () => {
    expect(pseudonym(' Bob@Example.com', PEPPER)).toBe(
      pseudonym('bob@example.com', PEPPER)
    )
    expect(pseudonym('bob@example.com', `${PEPPER}!`)).not.toBe(
      pseudonym('bob@example.com', PEPPER)
    )
    expect(pseudonym('bob@example.com', PEPPER)).toMatch(/^[0-9a-f]{64}$/)
  })
})
