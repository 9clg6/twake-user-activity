import * as Sentry from '@sentry/node'
import { createServer, handleSignals } from '@linagora/twake-node-server'
import { pino } from 'pino'
import { loadConfig } from './config.ts'
import { consumerAlive, consumerStats, startConsumer } from './infra/amqp.ts'
import { backendStats, registerMetrics } from './infra/metrics.ts'
import { createBatcher } from './modules/activity/batch.ts'
import { configuredSources } from './modules/sources.ts'
import { createTracker, reportsOn } from './product/tracker.ts'

const SHUTDOWN_DEADLINE_MS = 25_000

const config = loadConfig()
const logger = pino({ level: config.LOG_LEVEL })
const lifecycle = handleSignals({
  log: logger,
  deadlineMs: SHUTDOWN_DEADLINE_MS
})

const consumer = consumerStats()
const calls = backendStats()
let accepting = false
let isAlive = () => true

const server = createServer({
  logger,
  isReady: () => Promise.resolve(accepting && consumer.isSubscribed()),
  isAlive: () => isAlive()
})
await server.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT })
const metrics = createServer({ logger, isReady: () => Promise.resolve(true) })
registerMetrics(metrics, { consumer, backend: config.backend.kind, calls })
await metrics.listen({ host: config.HTTP_HOST, port: config.METRICS_PORT })

const tracker = createTracker(config.backend, {
  timeoutMs: config.ANALYTICS_TIMEOUT_MS,
  stats: calls
})
const batcher = createBatcher({
  tracker,
  size: config.BATCH_SIZE,
  waitMs: config.BATCH_WAIT_MS
})
const sources = configuredSources(config, {
  pepper: config.PSEUDONYM_PEPPER,
  logger,
  track: hit => batcher.submit(hit),
  tracks: reportsOn(config.backend),
  // The user's hits waiting here go first, or they would outlive the erasure.
  forget: async user => {
    await batcher.flush()
    await tracker.forget(user)
  }
})

const client = await startConsumer(config, logger, consumer, sources)
isAlive = consumerAlive(client, consumer)
accepting = true
logger.info(
  {
    queue: config.AMQP_QUEUE,
    exchanges: sources.map(source => source.exchange),
    backend: config.backend.kind
  },
  'consuming from RabbitMQ'
)

lifecycle.started(async () => {
  accepting = false
  // The deliveries in flight wait for their batch, which the flush sends.
  await Promise.all([client.close(), batcher.flush()])
  await Promise.all([server.close(), metrics.close()])
  await Sentry.flush(2000)
})
