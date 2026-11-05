import { describe, expect, it } from 'vitest'
import { posthogTracker } from './posthog.ts'
import { json, stubFetch } from './testing.ts'

const tracker = (fetch: typeof globalThis.fetch) =>
  posthogTracker({
    host: 'https://eu.i.posthog.com',
    apiKey: 'phc_key',
    timeoutMs: 1000,
    fetch
  })

describe('posthogTracker', () => {
  it('sends a batch as one capture request', async () => {
    const { fetch, calls } = stubFetch(json({ status: 1 }))
    const result = await tracker(fetch).track([
      {
        app: 'chat',
        user: 'f'.repeat(64),
        time: new Date('2026-10-24T10:30:00Z'),
        category: 'foreground',
        action: 'message.sent',
        tenant: 'acme123',
        platform: 'web',
        ip: '2001:db8::7'
      },
      {
        app: 'sso',
        user: 'e'.repeat(64),
        time: new Date('2026-10-24T10:31:00Z'),
        category: 'unclassified',
        action: 'activity'
      }
    ])
    expect(result.refused).toEqual(new Set())
    expect(calls).toEqual([
      {
        url: 'https://eu.i.posthog.com/batch/',
        body: {
          api_key: 'phc_key',
          batch: [
            {
              event: 'message.sent',
              distinct_id: 'f'.repeat(64),
              timestamp: '2026-10-24T10:30:00.000Z',
              properties: {
                $ip: '2001:db8::7',
                app: 'chat',
                category: 'foreground',
                tenant: 'acme123',
                $groups: { organization: 'acme123' },
                platform: 'web'
              }
            },
            {
              event: 'activity',
              distinct_id: 'e'.repeat(64),
              timestamp: '2026-10-24T10:31:00.000Z',
              properties: {
                $geoip_disable: true,
                app: 'sso',
                category: 'unclassified'
              }
            }
          ]
        },
        headers: { 'content-type': 'application/json' }
      }
    ])
  })

  it.each([
    ['an unreachable server', new TypeError('fetch failed'), 'transient'],
    ['a 502', json({}, 502), 'transient'],
    ['a refused key', json({}, 401), 'credentials'],
    ['a 400', json({}, 400), 'permanent']
  ])('classifies %s', async (_name, response, failure) => {
    const { fetch } = stubFetch(response)
    await expect(
      tracker(fetch).track([
        {
          app: 'chat',
          user: 'u',
          time: new Date(0),
          category: 'unclassified',
          action: 'activity'
        }
      ])
    ).rejects.toMatchObject({ name: 'ProductError', failure })
  })

  it('adds the properties of the app, under the keys of the bridge', async () => {
    const { fetch, calls } = stubFetch(json({ status: 1 }))
    await tracker(fetch).track([
      {
        app: 'chat',
        user: 'u',
        time: new Date(0),
        category: 'foreground',
        action: 'button.clicked',
        properties: { button: 'send', count: 3, app: 'other' }
      }
    ])
    const [sent] = (
      (calls[0]?.body ?? {}) as { batch: { properties: object }[] }
    ).batch
    expect(sent?.properties).toMatchObject({
      button: 'send',
      count: 3,
      app: 'chat'
    })
  })

  it('sets paying as a person property on a subscription change', async () => {
    const { fetch, calls } = stubFetch(json({ status: 1 }))
    await tracker(fetch).track([
      {
        app: 'billing',
        user: 'u',
        time: new Date(0),
        category: 'subscription',
        action: 'subscription-paying',
        paying: true
      }
    ])
    const [sent] = (
      (calls[0]?.body ?? {}) as { batch: { properties: object }[] }
    ).batch
    expect(sent?.properties).toMatchObject({ $set: { paying: true } })
  })

  it('deletes a person and their events with the personal key', async () => {
    const { fetch, calls } = stubFetch(json({ persons_found: 1 }, 202))
    await posthogTracker({
      host: 'https://eu.i.posthog.com',
      apiKey: 'phc_key',
      erasure: {
        host: 'https://eu.posthog.com/',
        projectId: '12345',
        personalApiKey: 'phx_key'
      },
      timeoutMs: 1000,
      fetch
    }).forget('u')
    expect(calls).toEqual([
      {
        url: 'https://eu.posthog.com/api/projects/12345/persons/bulk_delete/',
        body: { distinct_ids: ['u'], delete_events: true },
        headers: {
          authorization: 'Bearer phx_key',
          'content-type': 'application/json'
        }
      }
    ])
  })
})
