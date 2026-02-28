import { PostHog } from 'posthog-node'

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || ''
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://us.i.posthog.com'

let client = null

if (POSTHOG_API_KEY) {
  client = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST,
    flushAt: 10,         // batch up to 10 events before flush
    flushInterval: 5000, // or every 5s
  })
  console.log('[PostHog] Server-side client initialized')
} else {
  console.warn('[PostHog] POSTHOG_API_KEY not set — events will be dropped')
}

/**
 * Track a server-side event.
 * @param {string} distinctId - person ID or anonymous identifier
 * @param {string} event - event name (e.g. 'email_sent')
 * @param {object} properties - event properties
 */
export function trackEvent(distinctId, event, properties = {}) {
  if (!client) return
  try {
    client.capture({
      distinctId: String(distinctId),
      event,
      properties,
    })
  } catch (err) {
    console.error(`[PostHog] Failed to track ${event}:`, err.message)
  }
}

/**
 * Identify a person with properties (name only, no email per policy).
 * @param {string} distinctId - person ID
 * @param {object} properties - person properties
 */
export function identifyPerson(distinctId, properties = {}) {
  if (!client) return
  try {
    client.identify({
      distinctId: String(distinctId),
      properties,
    })
  } catch (err) {
    console.error(`[PostHog] Failed to identify ${distinctId}:`, err.message)
  }
}

/**
 * Flush pending events (call on shutdown).
 */
export async function shutdown() {
  if (!client) return
  try {
    await client.shutdown()
  } catch (err) {
    console.error('[PostHog] Shutdown error:', err.message)
  }
}
