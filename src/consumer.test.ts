import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { RabbitMQClient } from '@linagora/rabbitmq-client'
import { pino } from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.ts'
import { consumerStats, startConsumer } from './infra/amqp.ts'
import { createBatcher } from './modules/activity/batch.ts'
import { ROUTING_KEY as BILLING_ROUTING_KEY } from './modules/billing/handlers.ts'
import { ROUTING_KEYS } from './modules/erasure/handlers.ts'
import { configuredSources } from './modules/sources.ts'
import { reportsOn } from './product/tracker.ts'
import { fakeTracker } from './product/fake.ts'

// Against a real broker: docker compose up rabbitmq, or the one CI starts.
const AMQP_URL =
  process.env.TEST_AMQP_URL ?? 'amqp://guest:guest@localhost:5672'
const logger = pino({ level: 'silent' })

const event = (app: string, overrides: Record<string, unknown> = {}) => ({
  specversion: '1.0',
  id: randomUUID(),
  source: `twake://${app}`,
  type: `com.twake.${app}.user.active.v1`,
  time: new Date().toISOString(),
  twakeactor: 'alice@example.com',
  ...overrides
})

async function until(condition: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await delay(50)
  }
}

const clients: RabbitMQClient[] = []
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()))
})

async function start() {
  const name = `test-${randomUUID()}`
  const config = loadConfig({
    AMQP_URL,
    AMQP_EXCHANGE: name,
    AMQP_QUEUE: `${name}.ingest`,
    BILLING_EXCHANGE: `${name}.billing`,
    FEED_EXCHANGE: `${name}.feed`,
    B2B_EXCHANGE: `${name}.b2b`,
    BATCH_WAIT_MS: '20',
    MATOMO_URL: 'http://matomo.invalid',
    MATOMO_TOKEN: 'unused',
    MATOMO_SITES: '{"mail":1,"billing":2}',
    PSEUDONYM_PEPPER: 'a-pepper-that-is-at-least-32-characters'
  })
  const tracker = fakeTracker()
  const stats = consumerStats()
  const batcher = createBatcher({ tracker, size: 10, waitMs: 20 })
  const publisher = new RabbitMQClient({ url: AMQP_URL, logger })
  await publisher.init()
  clients.push(publisher)
  const publish = (body: Record<string, unknown>) =>
    publisher.publish(name, String(body.type), body)
  const publishBilling = (body: Record<string, unknown>) =>
    publisher.publish(`${name}.billing`, BILLING_ROUTING_KEY, body)
  const publishFeed = (body: Record<string, unknown>) =>
    publisher.publish(`${name}.feed`, String(body.type), body)
  const publishB2b = (body: Record<string, unknown>) =>
    publisher.publish(`${name}.b2b`, ROUTING_KEYS.b2b, body)
  // The bridge only checks for the exchanges others own, so stand in for their
  // owners, whose first publish declares them. Nothing is bound yet: these
  // are dropped.
  await publishBilling({})
  await publishFeed({})
  await publishB2b({})
  const consumer = await startConsumer(
    config,
    logger,
    stats,
    configuredSources(config, {
      pepper: config.PSEUDONYM_PEPPER,
      logger,
      track: hit => batcher.submit(hit),
      tracks: reportsOn(config.backend),
      forget: user => tracker.forget(user)
    })
  )
  clients.push(consumer)
  return { tracker, stats, publish, publishBilling, publishFeed, publishB2b }
}

describe('consumer', () => {
  it('tracks the activity events published for any app', async () => {
    const { tracker, publish } = await start()
    await publish(event('mail'))
    await publish(event('chat', { data: { action: 'message.sent' } }))
    await until(() => tracker.hits.length === 2)
    expect(tracker.hits.map(hit => [hit.app, hit.action])).toEqual([
      ['mail', 'activity'],
      ['chat', 'message.sent']
    ])
  })

  it('records subscription changes from the billing exchange', async () => {
    const { tracker, publishBilling } = await start()
    await publishBilling({
      twakeId: 'alice',
      internalEmail: 'alice@example.com',
      isPaying: true
    })
    await until(() => tracker.hits.length === 1)
    expect(tracker.hits[0]).toMatchObject({ app: 'billing', paying: true })
  })

  it('counts what a person did from the feed exchange', async () => {
    const { tracker, publishFeed } = await start()
    await publishFeed(
      event('mail', { type: 'com.twake.mail.space.provisioned.v1' })
    )
    await publishFeed(event('mail', { type: 'com.twake.mail.message.sent.v1' }))
    await until(() => tracker.hits.length === 1)
    expect(tracker.hits[0]).toMatchObject({
      app: 'mail',
      action: 'message.sent'
    })
  })

  it('erases a member ldap-rest deleted', async () => {
    const { tracker, publishB2b } = await start()
    await publishB2b({
      type: 'user.deleted',
      userId: 'alice',
      internalEmail: 'alice@example.com'
    })
    await until(() => tracker.forgotten.length === 1)
    expect(tracker.forgotten[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('drops a malformed event and keeps consuming', async () => {
    const { tracker, stats, publish } = await start()
    await publish(event('mail', { twakeactor: undefined }))
    await publish(event('mail'))
    await until(() => tracker.hits.length === 1)
    expect(stats.outcomes.get('dropped')).toBe(1)
  })

  it('dead letters what the backend refuses and keeps consuming', async () => {
    const { tracker, stats, publish } = await start()
    tracker.next = () => Promise.resolve({ refused: new Set([0]) })
    await publish(event('mail'))
    await until(() => stats.outcomes.get('dead_lettered') === 1)
    await publish(event('mail'))
    await until(() => tracker.hits.length === 1)
  })
})
