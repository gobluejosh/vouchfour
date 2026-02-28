import posthog from 'posthog-js'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || ''
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

let initialized = false

/**
 * Initialize PostHog client-side SDK.
 * Call once on app mount.
 */
export function initPostHog() {
  if (initialized || !POSTHOG_KEY) {
    if (!POSTHOG_KEY) console.warn('[PostHog] VITE_POSTHOG_KEY not set — client events will be dropped')
    return
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,             // we do manual event tracking
    capture_pageview: true,         // auto page views
    capture_pageleave: true,        // track when users leave
    persistence: 'localStorage',
    // Session replay — enabled on vouch and start-vouch pages
    session_recording: {
      maskAllInputs: true,          // mask form inputs for privacy
      maskTextSelector: '[data-ph-mask]',
    },
    loaded: (ph) => {
      // Enable session replay only on key funnel pages
      const path = window.location.pathname
      if (path === '/vouch' || path === '/start-vouch') {
        ph.startSessionRecording()
      }
    },
  })

  initialized = true
}

/**
 * Track a custom event.
 */
export function capture(event, properties = {}) {
  if (!initialized) return
  posthog.capture(event, properties)
}

/**
 * Identify a user (by person ID, with name but no email).
 */
export function identify(personId, properties = {}) {
  if (!initialized) return
  posthog.identify(String(personId), properties)
}

/**
 * Reset user identity (on logout).
 */
export function reset() {
  if (!initialized) return
  posthog.reset()
}

export default posthog
