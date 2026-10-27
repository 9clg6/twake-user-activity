import { describe, expect, it } from 'vitest'
import type { Hit } from '../product/port.ts'
import { configuredSources, routeMessages, type Source } from './sources.ts'

function route() {
  const hits: Hit[] = []
  const handle = routeMessages(
    configuredSources(
      {
        AMQP_EXCHANGE: 'user-activity',
        BILLING_EXCHANGE: 'billing',
        FEED_EXCHANGE: undefined,
        AUTH_EXCHANGE: undefined,
        B2B_EXCHANGE: undefined
      },
      {
        pepper: 'a-pepper-that-is-at-least-32-characters',
        logger: { warn: () => undefined },
        track: hit => {
          hits.push(hit)
          return Promise.resolve()
        },
        tracks: () => true,
        forget: () => Promise.resolve()
      }
    )
  )
  return { hits, handle }
}

const changed = { internalEmail: 'alice@example.com', isPaying: true }

const deps = {
  pepper: 'unused',
  logger: { warn: () => undefined },
  track: () => Promise.resolve(),
  tracks: () => true,
  forget: () => Promise.resolve()
}

describe('configuredSources', () => {
  it('reads only the bridge exchange when the others are off', () => {
    const sources = configuredSources(
      {
        AMQP_EXCHANGE: 'user-activity',
        BILLING_EXCHANGE: undefined,
        FEED_EXCHANGE: undefined,
        AUTH_EXCHANGE: undefined,
        B2B_EXCHANGE: undefined
      },
      deps
    )
    expect(sources.map(source => source.exchange)).toEqual(['user-activity'])
  })

  it('reads deletions from both ldap-rest exchanges', () => {
    const sources = configuredSources(
      {
        AMQP_EXCHANGE: 'user-activity',
        BILLING_EXCHANGE: undefined,
        FEED_EXCHANGE: undefined,
        AUTH_EXCHANGE: 'auth',
        B2B_EXCHANGE: 'b2b'
      },
      deps
    )
    expect(
      sources.map(({ exchange, routingKeys }) => [exchange, routingKeys[0]])
    ).toEqual([
      ['user-activity', 'com.twake.*.user.active.v1'],
      ['auth', 'user.deleted'],
      ['b2b', 'domain.user.deleted']
    ])
  })
})

describe('routeMessages', () => {
  it('reads a billing message at its publish time', async () => {
    const { hits, handle } = route()
    await handle(changed, {
      exchange: 'billing',
      routingKey: 'subscription.changed',
      headers: {},
      timestamp: 1_790_000_000
    })
    expect(hits[0]).toMatchObject({
      app: 'billing',
      time: new Date(1_790_000_000_000)
    })
  })

  it('still reads a billing message moved back from the dead letter queue', async () => {
    const { hits, handle } = route()
    await handle(changed, {
      exchange: '',
      routingKey: 'user-activity.ingest',
      headers: { 'x-first-death-exchange': 'billing' }
    })
    expect(hits[0]).toMatchObject({ app: 'billing', paying: true })
  })

  it('refuses two sources on one exchange', () => {
    const source: Source = {
      exchange: 'x',
      routingKeys: ['k'],
      passive: false,
      handle: () => Promise.resolve()
    }
    expect(() => routeMessages([source, source])).toThrow(/same exchange/)
  })
})
