import type { RabbitMQMessageProperties } from '@linagora/rabbitmq-client'
import type { Logger } from 'pino'
import type { Config } from '../config.ts'
import type { Hit } from '../product/port.ts'
import { activitySource } from './activity/handlers.ts'
import { billingSource } from './billing/handlers.ts'
import { erasureSource, ROUTING_KEYS } from './erasure/handlers.ts'
import { feedSource } from './feed/handlers.ts'

export type Handle = (
  body: unknown,
  properties: RabbitMQMessageProperties
) => Promise<void>

// One kind of message the bridge reads, from one exchange.
export interface Source {
  exchange: string
  routingKeys: readonly [string, ...string[]]
  // Another service owns the exchange: check it exists, never declare it.
  passive: boolean
  handle: Handle
}

export interface SourceDeps {
  pepper: string
  logger: Pick<Logger, 'warn'>
  track: (hit: Hit) => Promise<void>
  // Whether the backend reports on an app at all.
  tracks: (app: string) => boolean
  forget: (user: string) => Promise<void>
}

// The bridge's own exchange comes first: its routing key names the queue's
// dead letters. A source whose exchange is unset is off.
export function configuredSources(
  config: Pick<
    Config,
    | 'AMQP_EXCHANGE'
    | 'BILLING_EXCHANGE'
    | 'FEED_EXCHANGE'
    | 'AUTH_EXCHANGE'
    | 'B2B_EXCHANGE'
  >,
  deps: SourceDeps
): [Source, ...Source[]] {
  const optional = (
    exchange: string | undefined,
    source: (exchange: string) => Source
  ) => (exchange === undefined ? [] : [source(exchange)])
  return [
    activitySource(config.AMQP_EXCHANGE, deps),
    ...optional(config.BILLING_EXCHANGE, e => billingSource(e, deps)),
    ...optional(config.FEED_EXCHANGE, e => feedSource(e, deps)),
    ...optional(config.AUTH_EXCHANGE, e =>
      erasureSource(e, ROUTING_KEYS.auth, deps)
    ),
    ...optional(config.B2B_EXCHANGE, e =>
      erasureSource(e, ROUTING_KEYS.b2b, deps)
    )
  ]
}

// Every source shares one queue; the exchange tells them apart. A message moved
// back from the dead letter queue arrives from another exchange, and RabbitMQ
// keeps the one it was first published to in a header. Anything else, such as
// a message published straight to the queue, is read by the first source.
export function routeMessages(sources: readonly [Source, ...Source[]]): Handle {
  const byExchange = new Map(sources.map(source => [source.exchange, source]))
  if (byExchange.size !== sources.length) {
    throw new Error('two sources read the same exchange')
  }
  return (body, properties) => {
    const firstDeath = properties.headers['x-first-death-exchange']
    const exchange =
      typeof firstDeath === 'string' ? firstDeath : properties.exchange
    return (byExchange.get(exchange) ?? sources[0]).handle(body, properties)
  }
}
