import { z } from 'zod'
import { appName, BILLING_APP } from '../../config.ts'
import type { CloudEvent } from '../../events/envelope.ts'
import {
  PLATFORMS,
  type Platform,
  type Properties
} from '../../product/port.ts'

export const TYPE_PATTERN = /^com\.twake\.([^.]+)\.user\.active\.v1$/

// What the topic binding matches: the destination app is one word.
export const ROUTING_KEY = 'com.twake.*.user.active.v1'

// The keys the bridge sets itself on a PostHog event. `$` keys are PostHog's
// own, and the key pattern leaves them out.
const RESERVED_PROPERTIES = new Set(['app', 'category', 'tenant', 'platform'])

const PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const MAX_PROPERTIES = 50
const MAX_STRING = 200

// Analytics should lose a detail, not the event: keep what is valid, cut long
// strings, and say which keys went, never their values.
function cleanProperties(raw: unknown): {
  properties: Properties
  dropped: string[]
} {
  const properties: Record<string, string | number | boolean | null> = {}
  const dropped: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { properties, dropped: ['(not an object)'] }
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const valid =
      PROPERTY_KEY.test(key) &&
      !RESERVED_PROPERTIES.has(key) &&
      Object.keys(properties).length < MAX_PROPERTIES &&
      (typeof value === 'string' ||
        typeof value === 'boolean' ||
        value === null ||
        (typeof value === 'number' && Number.isFinite(value)))
    if (!valid) dropped.push(key)
    else {
      properties[key] =
        typeof value === 'string' ? value.slice(0, MAX_STRING) : value
    }
  }
  return { properties, dropped }
}

const activity = z.object({
  type: z.string().regex(TYPE_PATTERN),
  time: z.iso.datetime({ offset: true }),
  twakeactor: z.email(),
  twakeactorid: z.string().optional(),
  twakeorg: z.string().optional(),
  data: z
    .object({
      category: z.enum(['background', 'foreground']).optional(),
      action: z.string().min(1).max(255).optional(),
      platform: z.enum(PLATFORMS).optional(),
      ip: z.union([z.ipv4(), z.ipv6()]).optional(),
      properties: z.unknown().optional()
    })
    .default({})
})

export interface Activity {
  app: string
  email: string
  time: Date
  category?: 'background' | 'foreground'
  action?: string
  platform?: Platform
  ip?: string
  properties?: Properties
  org?: string
}

export type ActivityResult =
  | { ok: true; activity: Activity; droppedProperties: string[] }
  | { ok: false; error: string }

export function parseActivity(event: CloudEvent): ActivityResult {
  const result = activity.safeParse(event)
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) }
  }
  const { type, time, twakeactor, twakeorg, data } = result.data
  const app = appName.safeParse(TYPE_PATTERN.exec(type)?.[1])
  if (!app.success) return { ok: false, error: `bad app in ${type}` }
  // Its reports hold subscription changes only.
  if (app.data === BILLING_APP) {
    return { ok: false, error: `${BILLING_APP} is reserved` }
  }
  const { properties, dropped } = cleanProperties(
    data.properties === undefined ? {} : data.properties
  )
  return {
    ok: true,
    droppedProperties: dropped,
    activity: {
      app: app.data,
      email: twakeactor,
      time: new Date(time),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.action !== undefined && { action: data.action }),
      ...(data.platform !== undefined && { platform: data.platform }),
      ...(data.ip !== undefined && { ip: data.ip }),
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(twakeorg !== undefined && { org: twakeorg })
    }
  }
}
