import { createHmac } from 'node:crypto'
import { parseCloudEvent } from '../../events/envelope.ts'
import { MalformedEventError } from '../../events/errors.ts'
import type { Hit } from '../../product/port.ts'
import type { Source, SourceDeps } from '../sources.ts'
import { parseActivity, ROUTING_KEY, type Activity } from './schema.ts'

// Matomo records an event only when both its category and action are set.
export const UNCLASSIFIED = 'unclassified'
export const DEFAULT_ACTION = 'activity'

// Addresses differ in case between apps; the same person must hash the same.
export function pseudonym(email: string, pepper: string): string {
  return createHmac('sha256', pepper)
    .update(email.trim().toLowerCase())
    .digest('hex')
}

export function toHit(activity: Activity, pepper: string): Hit {
  return {
    app: activity.app,
    user: pseudonym(activity.email, pepper),
    time: activity.time,
    category: activity.category ?? UNCLASSIFIED,
    action: activity.action ?? DEFAULT_ACTION,
    ...(activity.org !== undefined && { tenant: activity.org }),
    ...(activity.platform !== undefined && { platform: activity.platform }),
    ...(activity.ip !== undefined && { ip: activity.ip }),
    ...(activity.properties !== undefined && {
      properties: activity.properties
    })
  }
}

export function activitySource(exchange: string, deps: SourceDeps): Source {
  const handle = activityHandler(deps)
  return {
    exchange,
    routingKeys: [ROUTING_KEY],
    passive: false,
    handle: body => handle(body)
  }
}

export function activityHandler(
  deps: Pick<SourceDeps, 'pepper' | 'track' | 'logger'>
): (body: unknown) => Promise<void> {
  return async body => {
    const envelope = parseCloudEvent(body)
    if (!envelope.ok) throw new MalformedEventError(envelope.error)
    const parsed = parseActivity(envelope.event)
    if (!parsed.ok) throw new MalformedEventError(parsed.error)
    if (parsed.droppedProperties.length > 0) {
      deps.logger.warn(
        { id: envelope.event.id, dropped: parsed.droppedProperties },
        'dropped properties of an activity'
      )
    }
    await deps.track(toHit(parsed.activity, deps.pepper))
  }
}
