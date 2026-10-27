export type Properties = Readonly<
  Record<string, string | number | boolean | null>
>

/** One activity, in the platform's terms. Each backend maps it to its own model. */
export interface Hit {
  app: string
  /** The pseudonymous user id, never an address. */
  user: string
  time: Date
  category: string
  action: string
  tenant?: string
  platform?: Platform
  /** The user's IP address as the app saw it, for the backend's geolocation. */
  ip?: string
  /** What the app says about the action. Only PostHog records it. */
  properties?: Properties
  /** Set on a subscription change: whether the user now pays. */
  paying?: boolean
}

export const PLATFORMS = ['web', 'desktop', 'mobile'] as const
export type Platform = (typeof PLATFORMS)[number]

export interface TrackResult {
  /** Indices of the hits the backend refused for good. */
  refused: ReadonlySet<number>
}

/**
 * `transient` may pass when tried again. `credentials` is transient too, but
 * means the service's own key is wrong, never the event. `permanent` will
 * never pass.
 */
export type ProductFailure = 'transient' | 'credentials' | 'permanent'

export class ProductError extends Error {
  override name = 'ProductError'
  readonly failure: ProductFailure
  constructor(
    message: string,
    failure: ProductFailure,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.failure = failure
  }
}

export interface Tracker {
  track(hits: readonly Hit[]): Promise<TrackResult>
  /** Erases everything the backend holds on a pseudonymous user. */
  forget(user: string): Promise<void>
}

export interface CallStats {
  record(result: string, seconds: number): void
}
