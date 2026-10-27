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
  const handle = activityHandler({
    pepper: PEPPER,
    track: hit => {
      hits.push(hit)
      return Promise.resolve()
    }
  })
  return { hits, handle }
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

  it.each([
    ['a nested value', { a: { b: 1 } }],
    ['an array', { a: [1] }],
    ['a long string', { a: 'x'.repeat(201) }],
    ['a number that is not finite', { a: Infinity }],
    ['a key with a dash', { 'a-b': 1 }],
    ['a key of PostHog', { $ip: '203.0.113.7' }],
    ['a key too long', { ['a'.repeat(65)]: 1 }],
    ['a key the bridge sets', { tenant: 'other' }],
    [
      'more than 50 keys',
      Object.fromEntries(
        Array.from({ length: 51 }, (_, i) => ['k' + String(i), i])
      )
    ]
  ])('drops an event with properties holding %s', async (_name, properties) => {
    const { hits, handle } = handler()
    await expect(
      handle(event({ data: { properties } }))
    ).rejects.toBeInstanceOf(MalformedEventError)
    expect(hits).toEqual([])
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
