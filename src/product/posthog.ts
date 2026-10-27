import { endpoint, postJson } from './http.ts'
import { ProductError, type CallStats, type Tracker } from './port.ts'

export interface PostHogOptions {
  host: string
  /** The project API key, which only allows capturing events. */
  apiKey: string
  /** Needed to erase users only: capture keys cannot delete. */
  erasure?: PostHogErasure | undefined
  timeoutMs: number
  fetch?: typeof fetch
  stats?: CallStats
}

export interface PostHogErasure {
  /** The app host, not the ingestion host. */
  host: string
  projectId: string
  /** A personal API key with the person:write scope. */
  personalApiKey: string
}

// PostHog answers 200 even for events that fail its validation, so it never
// refuses a single hit: the whole batch passes or fails.
export function posthogTracker(options: PostHogOptions): Tracker {
  const url = endpoint(options.host, 'batch/')
  return {
    // Events captured before the call are deleted with the person.
    async forget(user) {
      const { erasure } = options
      if (erasure === undefined) {
        throw new ProductError('PostHog erasure is not configured', 'permanent')
      }
      const { done } = await postJson(
        endpoint(
          erasure.host,
          `api/projects/${encodeURIComponent(erasure.projectId)}/persons/bulk_delete/`
        ),
        { distinct_ids: [user], delete_events: true },
        {
          ...options,
          headers: { authorization: `Bearer ${erasure.personalApiKey}` }
        }
      )
      done('ok')
    },
    async track(hits) {
      const { done } = await postJson(
        url,
        {
          api_key: options.apiKey,
          batch: hits.map(hit => ({
            event: hit.action,
            distinct_id: hit.user,
            timestamp: hit.time.toISOString(),
            properties: {
              // First, so the bridge's own keys win.
              ...hit.properties,
              // Every request comes from the bridge, so without the app's
              // address the request IP says nothing about where the user is.
              ...(hit.ip === undefined
                ? { $geoip_disable: true }
                : { $ip: hit.ip }),
              app: hit.app,
              category: hit.category,
              // The group too, so group analytics counts organizations, not
              // only people.
              ...(hit.tenant !== undefined && {
                tenant: hit.tenant,
                $groups: { organization: hit.tenant }
              }),
              ...(hit.platform !== undefined && { platform: hit.platform }),
              // A person property, so insights can count paying users.
              ...(hit.paying !== undefined && { $set: { paying: hit.paying } })
            }
          }))
        },
        options
      )
      done('ok')
      return { refused: new Set() }
    }
  }
}
