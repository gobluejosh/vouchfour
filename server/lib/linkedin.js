/**
 * Normalize a LinkedIn profile URL to canonical form.
 *
 * Handles variations:
 *   https://www.linkedin.com/in/joshscott/
 *   http://linkedin.com/in/JoshScott?trk=something
 *   linkedin.com/in/josh-scott
 *   https://uk.linkedin.com/in/joshscott
 *
 * Returns: 'https://linkedin.com/in/joshscott' or null if invalid
 */
export function normalizeLinkedInUrl(raw) {
  if (!raw || typeof raw !== 'string') return null

  let url = raw.trim()

  // Add protocol if missing
  if (!url.startsWith('http')) {
    url = 'https://' + url
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Must be a linkedin.com domain (any subdomain)
  if (!parsed.hostname.endsWith('linkedin.com')) return null

  // Extract the /in/slug portion
  const match = parsed.pathname.match(/^\/in\/([a-z0-9_-]+)/i)
  if (!match) return null

  const slug = match[1].toLowerCase()

  return `https://linkedin.com/in/${slug}`
}
