import { describe, expect, it } from 'vitest'
import { matomoTracker, type MatomoDimensions } from './matomo.ts'
import type { Hit } from './port.ts'
import { json, stubFetch } from './testing.ts'

const hit = (overrides: Partial<Hit> = {}): Hit => ({
  app: 'mail',
  user: 'f'.repeat(64),
  time: new Date('2026-10-24T10:30:00Z'),
  category: 'background',
  action: 'email.read',
  tenant: 'org.example.com',
  platform: 'mobile',
  ...overrides
})

const tracker = (
  fetch: typeof globalThis.fetch,
  dimensions: MatomoDimensions = { tenant: 1, platform: 2 }
) =>
  matomoTracker({
    url: 'https://matomo.example.com/analytics',
    token: 'secret',
    sites: { mail: 3, chat: 2 },
    dimensions,
    timeoutMs: 1000,
    fetch
  })

describe('matomoTracker', () => {
  it('ignores the properties of a hit', async () => {
    const send = async (hit: Hit) => {
      const { fetch, calls } = stubFetch(
        json({ status: 'success', tracked: 1, invalid: 0, invalid_indices: [] })
      )
      await tracker(fetch).track([hit])
      return calls[0]?.body
    }
    expect(await send(hit({ properties: { button: 'send' } }))).toEqual(
      await send(hit())
    )
  })

  it('sends a batch as one authenticated bulk request', async () => {
    const { fetch, calls } = stubFetch(
      json({ status: 'success', tracked: 1, invalid: 0, invalid_indices: [] })
    )
    await expect(tracker(fetch).track([hit()])).resolves.toEqual({
      refused: new Set()
    })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://matomo.example.com/analytics/matomo.php')
    const { requests, token_auth } = (call?.body ?? {}) as {
      requests: string[]
      token_auth: string
    }
    expect(token_auth).toBe('secret')
    expect(Object.fromEntries(new URLSearchParams(requests[0]))).toEqual({
      idsite: '3',
      rec: '1',
      apiv: '1',
      send_image: '0',
      uid: 'f'.repeat(64),
      cdt: String(Date.parse('2026-10-24T10:30:00Z') / 1000),
      e_c: 'background',
      e_a: 'email.read',
      ua: 'twake-user-activity',
      dimension1: 'org.example.com',
      dimension2: 'mobile'
    })
  })

  it('forwards the user address the app sent', async () => {
    const { fetch, calls } = stubFetch(
      json({ status: 'success', invalid_indices: [] })
    )
    await tracker(fetch).track([hit({ ip: '203.0.113.7' })])
    const [request] = ((calls[0]?.body ?? {}) as { requests: string[] })
      .requests
    expect(new URLSearchParams(request).get('cip')).toBe('203.0.113.7')
  })

  it('leaves out a dimension the config lacks', async () => {
    const { fetch, calls } = stubFetch(
      json({ status: 'success', invalid_indices: [] })
    )
    await tracker(fetch, { platform: 2 }).track([hit()])
    const [request] = ((calls[0]?.body ?? {}) as { requests: string[] })
      .requests
    const params = new URLSearchParams(request)
    expect(params.has('dimension1')).toBe(false)
    expect(params.get('dimension2')).toBe('mobile')
  })

  it('refuses an app with no site without sending it', async () => {
    const { fetch, calls } = stubFetch(
      json({ status: 'success', invalid_indices: [] })
    )
    const result = await tracker(fetch).track([
      hit({ app: 'drive' }),
      hit({ app: 'chat' })
    ])
    expect(result.refused).toEqual(new Set([0]))
    expect(
      ((calls[0]?.body ?? {}) as { requests: string[] }).requests
    ).toHaveLength(1)
  })

  it('maps the indices Matomo refused back to the batch', async () => {
    const { fetch } = stubFetch(
      json({ status: 'success', invalid: 1, invalid_indices: [1] })
    )
    const result = await tracker(fetch).track([
      hit({ app: 'drive' }),
      hit(),
      hit()
    ])
    expect(result.refused).toEqual(new Set([0, 2]))
  })

  it('takes a 204 as tracked', async () => {
    const { fetch } = stubFetch(new Response(null, { status: 204 }))
    await expect(tracker(fetch).track([hit()])).resolves.toEqual({
      refused: new Set()
    })
  })

  it.each([
    ['an unreachable server', new TypeError('fetch failed'), 'transient'],
    ['a 503', json({ status: 'error' }, 503), 'transient'],
    ['a 429', json({}, 429), 'transient'],
    ['a refused token', json({}, 401), 'credentials'],
    ['a 400', json({ status: 'error' }, 400), 'permanent'],
    ['a 200 that is not a success', json({ status: 'error' }), 'transient']
  ])('classifies %s', async (_name, response, failure) => {
    const { fetch } = stubFetch(response)
    await expect(tracker(fetch).track([hit()])).rejects.toMatchObject({
      name: 'ProductError',
      failure
    })
  })
})

describe('matomoTracker.forget', () => {
  const user = 'f'.repeat(64)
  const visit = (idSite: number, idVisit: number) => ({
    idSite,
    idVisit,
    userId: user
  })

  it('deletes every visit of the user until none is left', async () => {
    const { fetch, calls } = stubFetch(
      json([visit(3, 10), visit(2, 11)]),
      json({ log_visit: 2 }),
      json([])
    )
    await tracker(fetch).forget(user)
    expect(calls.map(call => call.url)).toEqual(
      Array(3).fill('https://matomo.example.com/analytics/index.php')
    )
    expect(calls[0]?.body).toMatchObject({
      method: 'PrivacyManager.findDataSubjects',
      idSite: 'all',
      segment: `userId==${user}`,
      token_auth: 'secret'
    })
    expect(calls[1]?.body).toMatchObject({
      method: 'PrivacyManager.deleteDataSubjects',
      'visits[0][idsite]': '3',
      'visits[0][idvisit]': '10',
      'visits[1][idsite]': '2',
      'visits[1][idvisit]': '11'
    })
  })

  it('erases a user Matomo never saw without deleting anything', async () => {
    const { fetch, calls } = stubFetch(json([]))
    await tracker(fetch).forget(user)
    expect(calls).toHaveLength(1)
  })

  it.each([
    [
      'a token without admin access',
      "You can't access this resource as it requires admin access for at least one website.",
      'credentials'
    ],
    ['any other refusal', 'Invalid segment', 'permanent']
  ])('classifies %s', async (_name, message, failure) => {
    const { fetch } = stubFetch(json({ result: 'error', message }))
    await expect(tracker(fetch).forget(user)).rejects.toMatchObject({
      name: 'ProductError',
      failure
    })
  })
})
