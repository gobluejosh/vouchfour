import './lib/env.js'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, getClient } from './lib/db.js'
import { normalizeLinkedInUrl } from './lib/linkedin.js'
import { getTalentRecommendations } from './lib/graph.js'
import { sendVouchInviteEmail, sendLoginLinkEmail } from './lib/email.js'
import { checkAndNotifyReadiness } from './lib/readiness.js'
import { processNudges, processVoucherNudges } from './lib/nudge.js'
import { trackEvent, identifyPerson, shutdown as posthogShutdown } from './lib/posthog.js'

const PORT = process.env.PORT || 3001

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ─── IP rate limiting (in-memory) ──────────────────────────────────
const ipRequestCounts = new Map() // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_MAX = 25 // max email-triggering requests per window per IP

function isRateLimited(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress
  const now = Date.now()
  const entry = ipRequestCounts.get(ip)
  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  if (entry.count > RATE_LIMIT_MAX) return true
  return false
}

// Clean up stale entries every 30 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of ipRequestCounts) {
    if (now > entry.resetAt) ipRequestCounts.delete(ip)
  }
}, 30 * 60 * 1000)

// ─── Per-recipient daily email cap ─────────────────────────────────
const DAILY_EMAIL_CAP = 3 // max emails per recipient per day

async function canEmailRecipient(recipientId) {
  const result = await query(
    `SELECT COUNT(*) AS cnt FROM sent_emails
     WHERE recipient_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`,
    [recipientId]
  )
  return Number(result.rows[0].cnt) < DAILY_EMAIL_CAP
}

// Static file serving for production
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function serveStaticFile(req, res) {
  // Try to serve the requested file from dist/
  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url)

  // Security: prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    return false
  }

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      const content = fs.readFileSync(filePath)

      // Cache static assets (hashed filenames) for 1 year, HTML for no-cache
      const cacheControl = ext === '.html'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable'

      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl })
      res.end(content)
      return true
    }
  } catch {}
  return false
}

// Set your Anthropic API key as an environment variable:
//   ANTHROPIC_API_KEY=sk-ant-... node server/index.js
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const BRAVE_API_KEY = process.env.BRAVE_API_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || ''
const ADMIN_SECRET = process.env.ADMIN_SECRET || ''

if (!ANTHROPIC_API_KEY || !BRAVE_API_KEY || !RESEND_API_KEY) {
  console.error('\n  ⚠  Missing required environment variables.')
  console.error('  Run:  ANTHROPIC_API_KEY=sk-ant-... BRAVE_API_KEY=BSA... RESEND_API_KEY=re_... npm run server\n')
  if (!ANTHROPIC_API_KEY) console.error('  - ANTHROPIC_API_KEY is missing')
  if (!BRAVE_API_KEY) console.error('  - BRAVE_API_KEY is missing')
  if (!RESEND_API_KEY) console.error('  - RESEND_API_KEY is missing')
  process.exit(1)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
      catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function parseCookies(req) {
  const cookies = {}
  const header = req.headers.cookie || ''
  header.split(';').forEach(part => {
    const [key, ...rest] = part.trim().split('=')
    if (key) cookies[key] = rest.join('=')
  })
  return cookies
}

function getSessionToken(req) {
  return parseCookies(req).vf_session || null
}

function requireAdmin(req, res) {
  const secret = req.headers['x-admin-secret']
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    res.writeHead(401)
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return false
  }
  return true
}

async function validateSession(req) {
  const sessionToken = getSessionToken(req)
  if (!sessionToken) return null
  const result = await query(
    `SELECT s.person_id, p.id, p.display_name, p.linkedin_url, p.email
     FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [sessionToken]
  )
  return result.rows[0] || null
}

// ─── Unsubscribe token helpers ─────────────────────────────────────────────
const UNSUB_SECRET = ADMIN_SECRET || 'vouchfour-unsub-key'

function generateUnsubToken(personId) {
  const sig = crypto.createHmac('sha256', UNSUB_SECRET).update(String(personId)).digest('hex').slice(0, 16)
  return `${personId}-${sig}`
}

function verifyUnsubToken(token) {
  const [idStr, sig] = (token || '').split('-')
  const personId = parseInt(idStr, 10)
  if (!personId || !sig) return null
  const expected = crypto.createHmac('sha256', UNSUB_SECRET).update(String(personId)).digest('hex').slice(0, 16)
  if (sig !== expected) return null
  return personId
}

function unsubscribeUrl(personId) {
  return `${BASE_URL}/unsubscribe?token=${generateUnsubToken(personId)}`
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

const server = http.createServer(async (req, res) => {
  // ─── Unsubscribe page (GET) + one-click handler (POST) ─────────────
  const unsubMatch = req.url.match(/^\/unsubscribe\?(.+)/)
  if (unsubMatch || req.url === '/unsubscribe') {
    const params = new URLSearchParams(req.url.split('?')[1] || '')
    const token = params.get('token')
    const personId = verifyUnsubToken(token)

    if (!personId) {
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Invalid link</h2><p>This unsubscribe link is invalid or expired.</p></body></html>')
      return
    }

    if (req.method === 'POST') {
      await query('UPDATE people SET unsubscribed_at = NOW() WHERE id = $1', [personId])
      const person = await query('SELECT display_name FROM people WHERE id = $1', [personId])
      const name = person.rows[0]?.display_name?.split(' ')[0] || ''
      console.log(`[Unsubscribe] Unsubscribed person ${personId} (${name})`)
      trackEvent(String(personId), 'unsubscribed', { person_id: personId })

      // Check if request is from email client (RFC 8058 one-click) or browser form
      const contentType = req.headers['content-type'] || ''
      if (contentType.includes('application/x-www-form-urlencoded') && !req.headers['list-unsubscribe']) {
        // Browser form submission — show confirmation page
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="font-family:'Helvetica Neue',Arial,sans-serif;text-align:center;padding:60px;color:#1C1917;">
          <h2 style="margin-bottom:8px">You've been unsubscribed</h2>
          <p style="color:#78716C">${name ? name + ', you' : 'You'} will no longer receive emails from VouchFour.</p>
        </body></html>`)
        return
      }

      // RFC 8058 one-click from email client UI
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
      return
    }

    // GET: show confirmation page
    const person = await query('SELECT display_name, unsubscribed_at FROM people WHERE id = $1', [personId])
    const name = person.rows[0]?.display_name?.split(' ')[0] || ''
    const alreadyUnsub = !!person.rows[0]?.unsubscribed_at

    if (alreadyUnsub) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<html><body style="font-family:'Helvetica Neue',Arial,sans-serif;text-align:center;padding:60px;color:#1C1917;">
        <h2 style="margin-bottom:8px">Already unsubscribed</h2>
        <p style="color:#78716C">${name ? name + ', you are' : 'You are'} already unsubscribed from VouchFour emails.</p>
      </body></html>`)
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<html><body style="font-family:'Helvetica Neue',Arial,sans-serif;text-align:center;padding:60px;color:#1C1917;">
      <h2 style="margin-bottom:8px">Unsubscribe from VouchFour</h2>
      <p style="color:#78716C;margin-bottom:24px">${name ? name + ', click' : 'Click'} below to stop receiving emails from VouchFour.</p>
      <form method="POST" action="/unsubscribe?token=${token}">
        <button type="submit" style="padding:12px 28px;background:#2563EB;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">
          Unsubscribe
        </button>
      </form>
    </body></html>`)
    return
  }

  // Only set API headers for /api routes
  if (req.url.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
  }

  // ─── Health check ──────────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200)
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  // ─── Job functions list ──────────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/job-functions') {
    try {
      const result = await query(
        'SELECT id, name, slug, practitioner_label, display_order FROM job_functions ORDER BY display_order'
      )
      res.writeHead(200)
      res.end(JSON.stringify({ jobFunctions: result.rows }))
    } catch (err) {
      console.error('[/api/job-functions error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Identify user (upsert person by LinkedIn) ─────────────────────
  if (req.method === 'POST' && req.url === '/api/identify') {
    if (isRateLimited(req)) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }
    try {
      const body = await readBody(req)
      const { name, email, linkedin } = body
      if (!name?.trim() || !linkedin?.trim()) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Name and LinkedIn URL are required' }))
        return
      }
      const normalizedLinkedin = normalizeLinkedInUrl(linkedin)
      if (!normalizedLinkedin) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Please enter a valid LinkedIn URL' }))
        return
      }
      // Find or create person by LinkedIn URL
      const existingPerson = await query(
        'SELECT id FROM people WHERE linkedin_url = $1',
        [normalizedLinkedin]
      )
      let personId
      if (existingPerson.rows.length > 0) {
        personId = existingPerson.rows[0].id
        await query(
          `UPDATE people SET display_name = COALESCE(NULLIF($2, ''), display_name),
           email = COALESCE(NULLIF($3, ''), email),
           self_provided = TRUE WHERE id = $1`,
          [personId, name.trim(), email?.trim()?.toLowerCase() || null]
        )
      } else {
        const insertRes = await query(
          'INSERT INTO people (display_name, email, linkedin_url, self_provided) VALUES ($1, $2, $3, TRUE) RETURNING id',
          [name.trim(), email?.trim()?.toLowerCase() || null, normalizedLinkedin]
        )
        personId = insertRes.rows[0].id
      }
      identifyPerson(String(personId), { name: name.trim() })
      trackEvent(String(personId), 'user_identified', { person_id: personId, is_new: existingPerson.rows.length === 0 })

      res.writeHead(200)
      res.end(JSON.stringify({ personId }))
    } catch (err) {
      console.error('[/api/identify error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Start vouch chain ────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/start-vouch') {
    if (isRateLimited(req)) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }
    try {
      const body = await readBody(req)
      const { jobFunctionId } = body

      // Validate job function
      const jfRes = await query('SELECT id, name, slug, practitioner_label FROM job_functions WHERE id = $1', [jobFunctionId])
      if (jfRes.rows.length === 0) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid job function' }))
        return
      }

      // Determine the user — session, personId, or inline identity
      let userId
      const session = await validateSession(req)
      if (session) {
        userId = session.id
      } else if (body.personId) {
        // Person already identified via /api/identify
        const personCheck = await query('SELECT id FROM people WHERE id = $1', [body.personId])
        if (personCheck.rows.length === 0) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Invalid person ID' }))
          return
        }
        userId = body.personId
      } else {
        // Inline identity (fallback)
        const { name, email, linkedin } = body
        if (!name?.trim() || !linkedin?.trim()) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Name and LinkedIn URL are required' }))
          return
        }
        const normalizedLinkedin = normalizeLinkedInUrl(linkedin)
        if (!normalizedLinkedin) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Please enter a valid LinkedIn URL' }))
          return
        }
        const existingPerson = await query(
          'SELECT id FROM people WHERE linkedin_url = $1',
          [normalizedLinkedin]
        )
        if (existingPerson.rows.length > 0) {
          userId = existingPerson.rows[0].id
        } else {
          const insertRes = await query(
            'INSERT INTO people (display_name, email, linkedin_url) VALUES ($1, $2, $3) RETURNING id',
            [name.trim(), email?.trim()?.toLowerCase() || null, normalizedLinkedin]
          )
          userId = insertRes.rows[0].id
        }
      }

      // Check if user already has a self-vouch invite for this function
      const existingRes = await query(`
        SELECT token FROM vouch_invites
        WHERE inviter_id = $1 AND invitee_id = $1
          AND job_function_id = $2
        ORDER BY created_at DESC LIMIT 1
      `, [userId, jobFunctionId])

      if (existingRes.rows.length > 0) {
        res.writeHead(200)
        res.end(JSON.stringify({ token: existingRes.rows[0].token }))
        return
      }

      // Create self-referencing vouch invite
      const token = crypto.randomUUID()
      await query(`
        INSERT INTO vouch_invites (token, inviter_id, invitee_id, job_function_id)
        VALUES ($1, $2, $3, $4)
      `, [token, userId, userId, jobFunctionId])

      res.writeHead(200)
      res.end(JSON.stringify({ token }))
    } catch (err) {
      console.error('[/api/start-vouch error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── User's vouched functions (lightweight, for StartVouchPage) ────
  if (req.method === 'GET' && req.url === '/api/my-vouch-functions') {
    try {
      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }
      const result = await query(`
        SELECT DISTINCT jf.id, jf.slug, jf.name
        FROM vouches v
        JOIN job_functions jf ON jf.id = v.job_function_id
        WHERE v.voucher_id = $1
      `, [session.id])
      res.writeHead(200)
      res.end(JSON.stringify({ vouchedFunctions: result.rows.map(r => r.slug) }))
    } catch (err) {
      console.error('[/api/my-vouch-functions error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── LinkedIn profile lookup via Brave Search API ────────────────────
  if (req.method === 'POST' && req.url === '/api/lookup-linkedin') {
    try {
      const body = await readBody(req)
      const name = body.name || ''
      console.log(`[LinkedIn] Request for: "${name}"`)
      const startTime = Date.now()

      if (!name.trim()) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'name is required', profiles: [] }))
        return
      }

      const query = `${name} linkedin profile`
      const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`

      const braveRes = await fetch(braveUrl, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY,
        },
      })

      const braveData = await braveRes.json()
      const results = (braveData.web?.results || [])

      // Parse LinkedIn /in/ profile URLs from search results
      const profiles = results
        .filter(r => r.url && /linkedin\.com\/in\/[a-z0-9-]+/i.test(r.url))
        .filter(r => !/\/pub\/dir\//i.test(r.url)) // exclude directory pages
        .map(r => {
          const url = r.url.split('?')[0] // strip tracking params

          // Title is usually "Full Name - Title - Company | LinkedIn"
          const title = r.title || ''
          const titleParts = title.replace(/\s*[|–]\s*LinkedIn$/i, '').split(/\s*[-–]\s*/)
          const label = titleParts[0]?.trim() || name

          // Build detail from remaining title parts, or fall back to description
          let detail = titleParts.slice(1).join(' · ').trim()
          if (!detail && r.description) {
            // Pull first meaningful chunk from description
            detail = r.description.replace(/^[^·]*·\s*/, '').slice(0, 80).trim()
          }

          return { url, label, detail }
        })
        .slice(0, 3)

      console.log(`[LinkedIn] Found ${profiles.length} profiles in ${Date.now() - startTime}ms`)
      res.writeHead(200)
      res.end(JSON.stringify({ profiles }))
    } catch (err) {
      console.error('[/api/lookup-linkedin error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error', profiles: [] }))
    }
    return
  }

  // ─── Email finder: Brave fast path → Claude fallback ─────────────────
  if (req.method === 'POST' && req.url === '/api/find-email') {
    try {
      const body = await readBody(req)
      const { fullName, linkedinUrl, detail, braveOnly } = body

      console.log(`[Email] Request for: "${fullName}" / "${detail}"${braveOnly ? ' (brave-only)' : ''}`)
      const startTime = Date.now()

      if (!fullName?.trim()) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'fullName is required', emails: [] }))
        return
      }

      // ── Step 0: Check if we already know this person's email ──────────
      if (linkedinUrl) {
        const normalizedUrl = normalizeLinkedInUrl(linkedinUrl)
        if (normalizedUrl) {
          const knownPerson = await query(
            'SELECT email FROM people WHERE linkedin_url = $1 AND email IS NOT NULL AND email != \'\'',
            [normalizedUrl]
          )
          if (knownPerson.rows.length > 0) {
            console.log(`[Email] Found known email for ${fullName} in DB (${Date.now() - startTime}ms)`)
            trackEvent('server', 'email_lookup_completed', { source: 'db_cache', has_result: true, duration_ms: Date.now() - startTime })
            res.writeHead(200)
            res.end(JSON.stringify({
              emails: [{ email: knownPerson.rows[0].email, confidence: 100, source: 'known' }]
            }))
            return
          }
        }
      }

      // Extract company from detail (e.g. "CEO · Anuvi" → "Anuvi")
      let company = ''
      if (detail) {
        const m = detail.match(/[·•]\s*(.+)$/) || detail.match(/at\s+(.+)$/i) || detail.match(/[-–]\s*(.+)$/)
        company = m ? m[1].trim() : ''
      }

      // ── Step 1: Apollo People Match (fast, reliable) ──────────────────
      if (APOLLO_API_KEY && linkedinUrl) {
        try {
          const normalizedUrl = normalizeLinkedInUrl(linkedinUrl)
          const apolloRes = await fetch('https://api.apollo.io/api/v1/people/match', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': APOLLO_API_KEY,
            },
            body: JSON.stringify({
              linkedin_url: normalizedUrl || linkedinUrl,
              reveal_personal_emails: true,
            }),
          })

          if (apolloRes.ok) {
            const apolloData = await apolloRes.json()
            const person = apolloData.person
            if (person?.email) {
              const confidence = person.email_status === 'verified' ? 95
                : person.email_status === 'guessed' ? 65
                : 75
              console.log(`[Email] Apollo found ${person.email} (${person.email_status}, ${confidence}%) in ${Date.now() - startTime}ms`)
              trackEvent('server', 'email_lookup_completed', { source: 'apollo', has_result: true, confidence, duration_ms: Date.now() - startTime })
              res.writeHead(200)
              res.end(JSON.stringify({
                emails: [{ email: person.email, confidence, source: 'apollo' }],
                source: 'apollo',
              }))
              return
            }
          }
          console.log(`[Email] Apollo: no email found (${Date.now() - startTime}ms)`)
        } catch (err) {
          console.warn(`[Email] Apollo error (falling back to Brave):`, err.message)
        }
      }

      // ── Step 2: Brave Search (fast, ~500ms) ──────────────────────────
      const braveQuery = company
        ? `${fullName} ${company} email contact`
        : `${fullName} email contact`
      const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(braveQuery)}&count=10`

      const braveRes = await fetch(braveUrl, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY,
        },
      })
      const braveData = await braveRes.json()
      const braveResults = braveData.web?.results || []

      // Extract email addresses from titles and descriptions
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
      const foundEmails = new Map() // email → {confidence, source}

      // Build name parts for relevance checking
      const nameParts = fullName.toLowerCase().split(/\s+/)
      const firstName = nameParts[0] || ''
      const lastName = nameParts[nameParts.length - 1] || ''

      for (const r of braveResults) {
        const text = `${r.title || ''} ${r.description || ''}`
        const textLower = text.toLowerCase()

        // Only consider results that mention the person's name
        const hasLastName = lastName && textLower.includes(lastName)
        const hasFirstName = firstName && textLower.includes(firstName)
        if (!hasLastName && !hasFirstName) continue

        const matches = text.match(emailRegex) || []
        for (const email of matches) {
          const lower = email.toLowerCase()
          // Skip generic/placeholder addresses
          if (/^(info|support|hello|contact|admin|noreply|no-reply|email)@/.test(lower)) continue
          if (/\*/.test(email)) continue
          if (foundEmails.has(lower)) continue

          // Score based on source quality and name match in email
          const url = r.url || ''
          let confidence = 50
          let source = 'web search result'

          // Boost if from a professional directory
          if (/rocketreach|contactout|zoominfo|signalhire|apollo/.test(url)) {
            confidence = 70
            source = 'professional directory'
          }

          // Boost if the result mentions both first AND last name
          if (hasFirstName && hasLastName) confidence += 10

          // Boost if email itself contains parts of the name
          const emailLocal = lower.split('@')[0]
          if (emailLocal.includes(lastName)) confidence += 10
          if (emailLocal.includes(firstName)) confidence += 5

          // Boost if from company domain
          if (company && new RegExp(company.split(/\s+/)[0], 'i').test(url)) {
            confidence = Math.max(confidence, 85)
            source = 'company website'
          }

          confidence = Math.min(confidence, 95) // cap it

          foundEmails.set(lower, { email: lower, confidence, source })
        }
      }

      const braveEmails = [...foundEmails.values()]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)

      console.log(`[Email] Brave found ${braveEmails.length} emails in ${Date.now() - startTime}ms`)

      // If Brave found emails, return them immediately
      if (braveEmails.length > 0) {
        trackEvent('server', 'email_lookup_completed', { source: 'brave', has_result: true, result_count: braveEmails.length, duration_ms: Date.now() - startTime })
        res.writeHead(200)
        res.end(JSON.stringify({ emails: braveEmails, source: 'brave' }))
        return
      }

      // ── Step 3: Claude fallback (slower, ~5-15s) ─────────────────────
      // If braveOnly mode, return empty immediately (for prefetch)
      if (braveOnly) {
        console.log(`[Email] Brave-only mode, skipping Claude (${Date.now() - startTime}ms)`)
        res.writeHead(200)
        res.end(JSON.stringify({ emails: [], source: 'brave' }))
        return
      }

      console.log(`[Email] No Brave results, falling back to Claude...`)

      let context = `Find the professional/work email address for: ${fullName}`
      if (detail) context += `\nThey are: ${detail}`
      if (linkedinUrl) context += `\nLinkedIn: ${linkedinUrl}`

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `You are an email finder. Search the web to find the person's professional email address. Return JSON only — no other text, no markdown.

Return exactly this structure:
{
  "emails": [
    { "email": "address@domain.com", "confidence": 85, "source": "found on company website" }
  ]
}

Rules:
- Search for their email on company websites, professional directories, press releases, conference speaker pages, GitHub, personal websites, etc.
- confidence: 90+ if email is directly visible on a webpage, 70-89 if strongly implied, 50-69 if a reasonable guess
- source: brief note on where/how you found or inferred it
- Up to 3 results, best first
- Only return real email addresses, not made-up ones
- If nothing found at all, return { "emails": [] }`,
          messages: [{ role: 'user', content: context }],
        }),
      })

      const data = await claudeRes.json()
      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')

      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        console.log(`[Email] Claude also found nothing (${Date.now() - startTime}ms)`)
        res.writeHead(200)
        res.end(JSON.stringify({ emails: [] }))
        return
      }

      const parsed = JSON.parse(match[0])
      console.log(`[Email] Claude found ${(parsed.emails||[]).length} emails in ${Date.now() - startTime}ms`)
      trackEvent('server', 'email_lookup_completed', { source: 'claude', has_result: (parsed.emails||[]).length > 0, result_count: (parsed.emails||[]).length, duration_ms: Date.now() - startTime })
      res.writeHead(200)
      res.end(JSON.stringify({ emails: parsed.emails || [], source: 'claude' }))
    } catch (err) {
      console.error('[/api/find-email error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error', emails: [] }))
    }
    return
  }

  // ─── Validate vouch invite token ───────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/vouch-invite/')) {
    try {
      const token = req.url.split('/api/vouch-invite/')[1]
      if (!token) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Token is required' }))
        return
      }

      const result = await query(`
        SELECT vi.id, vi.status, vi.invitee_id, vi.inviter_id, vi.job_function_id,
               p.display_name, p.linkedin_url, p.email,
               inviter.display_name AS inviter_name,
               jf.id AS jf_id, jf.name AS jf_name, jf.slug AS jf_slug, jf.practitioner_label AS jf_practitioner_label
        FROM vouch_invites vi
        JOIN people p ON p.id = vi.invitee_id
        JOIN people inviter ON inviter.id = vi.inviter_id
        LEFT JOIN job_functions jf ON jf.id = vi.job_function_id
        WHERE vi.token = $1
      `, [token])

      if (result.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Invalid or expired invite token' }))
        return
      }

      const invite = result.rows[0]
      const isSelfInvite = invite.inviter_id === invite.invitee_id

      // Build base response
      const baseResponse = {
        name: invite.display_name,
        linkedin: invite.linkedin_url,
        email: invite.email,
        inviterName: isSelfInvite ? null : invite.inviter_name,
        jobFunction: invite.jf_id ? {
          id: invite.jf_id,
          name: invite.jf_name,
          slug: invite.jf_slug,
          practitionerLabel: invite.jf_practitioner_label,
        } : null,
      }

      // For completed invites or re-vouch, load existing vouches
      if (invite.status === 'completed') {
        const vouchesRes = await query(`
          SELECT p.display_name AS name, p.linkedin_url AS linkedin, p.email,
                 EXISTS(
                   SELECT 1 FROM vouch_invites vi
                   WHERE vi.inviter_id = $1 AND vi.invitee_id = v.vouchee_id
                     AND vi.job_function_id = $2 AND vi.status = 'completed'
                 ) AS responded
          FROM vouches v
          JOIN people p ON p.id = v.vouchee_id
          WHERE v.voucher_id = $1 AND v.job_function_id = $2
          ORDER BY v.created_at
        `, [invite.invitee_id, invite.job_function_id])

        res.writeHead(200)
        res.end(JSON.stringify({ ...baseResponse, isUpdate: true, existingVouches: vouchesRes.rows }))
        return
      }

      // Check if this person has vouched before in this function
      const hasVouched = await query(
        `SELECT 1 FROM vouches WHERE voucher_id = $1 AND job_function_id = $2 LIMIT 1`,
        [invite.invitee_id, invite.job_function_id]
      )
      if (hasVouched.rows.length > 0) {
        const vouchesRes = await query(`
          SELECT p.display_name AS name, p.linkedin_url AS linkedin, p.email,
                 EXISTS(
                   SELECT 1 FROM vouch_invites vi
                   WHERE vi.inviter_id = $1 AND vi.invitee_id = v.vouchee_id
                     AND vi.job_function_id = $2 AND vi.status = 'completed'
                 ) AS responded
          FROM vouches v
          JOIN people p ON p.id = v.vouchee_id
          WHERE v.voucher_id = $1 AND v.job_function_id = $2
          ORDER BY v.created_at
        `, [invite.invitee_id, invite.job_function_id])
        res.writeHead(200)
        res.end(JSON.stringify({ ...baseResponse, isUpdate: true, existingVouches: vouchesRes.rows }))
        return
      }

      res.writeHead(200)
      res.end(JSON.stringify(baseResponse))
    } catch (err) {
      console.error('[/api/vouch-invite error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Submit Vouch form (token-based) ───────────────────────────────
  if (req.method === 'POST' && req.url === '/api/submit-vouch') {
    if (isRateLimited(req)) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }
    const client = await getClient()
    try {
      const body = await readBody(req)
      const { token, recommendations } = body

      if (!token) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'token is required' }))
        client.release()
        return
      }

      // Look up invite (allow both pending and completed for updates)
      const inviteRes = await query(`
        SELECT vi.id, vi.inviter_id, vi.invitee_id, vi.status, vi.job_function_id,
               p.display_name,
               jf.id AS jf_id, jf.name AS jf_name, jf.slug AS jf_slug, jf.practitioner_label AS jf_practitioner_label
        FROM vouch_invites vi
        JOIN people p ON p.id = vi.invitee_id
        LEFT JOIN job_functions jf ON jf.id = vi.job_function_id
        WHERE vi.token = $1
      `, [token])

      if (inviteRes.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Invalid invite token' }))
        client.release()
        return
      }

      const invite = inviteRes.rows[0]
      const isUpdate = invite.status === 'completed'
      const voucherId = invite.invitee_id
      const jobFunctionId = invite.job_function_id

      // ── NEW MODEL (has job_function_id) ──
      if (jobFunctionId) {
        await client.query('BEGIN')

        // Snapshot existing vouches for this function
        const existingVouchesRes = await client.query(`
          SELECT p.id, p.linkedin_url, p.email
          FROM vouches v
          JOIN people p ON p.id = v.vouchee_id
          WHERE v.voucher_id = $1 AND v.job_function_id = $2
        `, [voucherId, jobFunctionId])
        const existingByUrl = new Map()
        for (const row of existingVouchesRes.rows) {
          existingByUrl.set(row.linkedin_url, { id: row.id, email: row.email })
        }

        // Create submission record
        const subRes = await client.query(`
          INSERT INTO submissions (submitter_id, form_type, submitted_at, raw_payload, job_function_id)
          VALUES ($1, 'vouch', NOW(), $2, $3)
          RETURNING id
        `, [voucherId, JSON.stringify(body), jobFunctionId])
        const submissionId = subRes.rows[0].id

        // Process each recommendation
        const vouchedPeople = []
        for (const r of (recommendations || [])) {
          if (!r?.linkedin || !r?.name) continue
          const talentUrl = normalizeLinkedInUrl(r.linkedin)
          if (!talentUrl) continue

          const existing = existingByUrl.get(talentUrl)
          const isNew = !existing

          // Upsert talent person
          const talentRes = await client.query(`
            INSERT INTO people (linkedin_url, display_name, email)
            VALUES ($1, $2, $3)
            ON CONFLICT (linkedin_url) DO UPDATE
            SET display_name = CASE WHEN people.self_provided THEN people.display_name
                                    ELSE COALESCE(NULLIF(EXCLUDED.display_name, ''), people.display_name) END,
                email = CASE WHEN people.self_provided THEN people.email
                             ELSE COALESCE(EXCLUDED.email, people.email) END,
                updated_at = NOW()
            RETURNING id
          `, [talentUrl, r.name, r.email || null])
          const talentId = talentRes.rows[0].id

          // Insert into vouches table
          await client.query(`
            INSERT INTO vouches (voucher_id, vouchee_id, job_function_id, submission_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (voucher_id, vouchee_id, job_function_id)
            DO UPDATE SET submission_id = EXCLUDED.submission_id, created_at = NOW()
          `, [voucherId, talentId, jobFunctionId, submissionId])

          vouchedPeople.push({
            id: talentId, display_name: r.name,
            email: r.email || null, linkedin_url: talentUrl,
            isNew,
          })
        }

        // Mark invite as completed
        await client.query(`
          UPDATE vouch_invites SET status = 'completed', submission_id = $1
          WHERE id = $2
        `, [submissionId, invite.id])

        // Handle removals: only remove vouches where vouchee hasn't responded yet
        const currentVouchUrls = (recommendations || [])
          .map(r => r?.linkedin ? normalizeLinkedInUrl(r.linkedin) : null)
          .filter(Boolean)
        for (const [url, existing] of existingByUrl) {
          if (!currentVouchUrls.includes(url)) {
            // Check if this person has responded (has a completed invite from this voucher)
            const respondedRes = await client.query(`
              SELECT 1 FROM vouch_invites
              WHERE inviter_id = $1 AND invitee_id = $2 AND job_function_id = $3 AND status = 'completed'
              LIMIT 1
            `, [voucherId, existing.id, jobFunctionId])
            if (respondedRes.rows.length === 0) {
              await client.query(
                `DELETE FROM vouches WHERE voucher_id = $1 AND vouchee_id = $2 AND job_function_id = $3`,
                [voucherId, existing.id, jobFunctionId]
              )
              // Also delete pending invite
              await client.query(
                `DELETE FROM vouch_invites WHERE inviter_id = $1 AND invitee_id = $2 AND job_function_id = $3 AND status = 'pending'`,
                [voucherId, existing.id, jobFunctionId]
              )
              console.log(`[Vouch] Removed vouch for ${url} from ${invite.display_name}'s ${invite.jf_name} recommendations`)
            } else {
              console.log(`[Vouch] Skipping removal of ${url} — already responded`)
            }
          }
        }

        // Create new pending invite for future updates
        if (isUpdate) {
          const newToken = crypto.randomUUID()
          await client.query(
            `INSERT INTO vouch_invites (token, inviter_id, invitee_id, job_function_id) VALUES ($1, $2, $3, $4)`,
            [newToken, invite.inviter_id, voucherId, jobFunctionId]
          )
        }

        await client.query('COMMIT')

        const newPeople = vouchedPeople.filter(v => v.isNew)
        console.log(`[Vouch] ${invite.display_name} ${isUpdate ? 'updated' : 'submitted'} ${invite.jf_name} vouches for ${vouchedPeople.length} people (${newPeople.length} new)`)

        identifyPerson(String(voucherId), { name: invite.display_name })
        trackEvent(String(voucherId), 'vouch_submitted', {
          person_id: voucherId,
          job_function: invite.jf_name,
          job_function_slug: invite.jf_slug,
          vouch_count: vouchedPeople.length,
          new_vouchee_count: newPeople.length,
          is_update: isUpdate,
        })

        res.writeHead(200)
        res.end(JSON.stringify({ ok: true, personId: voucherId }))

        // ── Post-commit: send invite emails + check readiness ──

        const jobFunction = { id: invite.jf_id, name: invite.jf_name, slug: invite.jf_slug, practitionerLabel: invite.jf_practitioner_label }
        const inviterFullName = invite.display_name

        // Send vouch_invite emails to all new vouchees. Chain propagation is
        // unlimited — every vouched person gets an invite. Display depth is
        // controlled on the talent profile page instead.
        ;(async () => {
          for (const talent of newPeople) {
            if (!talent.email) continue
            try {
              if (!(await canEmailRecipient(talent.id))) {
                console.log(`[Email] Daily cap reached for ${talent.display_name}, skipping vouch_invite`)
                continue
              }

              const newToken = crypto.randomUUID()
              await query(
                `INSERT INTO vouch_invites (token, inviter_id, invitee_id, job_function_id) VALUES ($1, $2, $3, $4)`,
                [newToken, voucherId, talent.id, jobFunctionId]
              )

              const resendId = await sendVouchInviteEmail(talent, inviterFullName, jobFunction, newToken)
              await query(
                `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
                 VALUES ($1, 'vouch_invite', $2, $3)`,
                [talent.id, invite.id, resendId]
              )
            } catch (err) {
              console.error(`[Email] Failed to send vouch_invite to ${talent.display_name}:`, err.message)
            }
            await sleep(600)
          }
        })()

        // Check readiness for all sponsors (people who vouched for this voucher)
        const sponsorsRes = await query(`
          SELECT DISTINCT voucher_id FROM vouches
          WHERE vouchee_id = $1 AND job_function_id = $2
        `, [voucherId, jobFunctionId])

        for (const sponsor of sponsorsRes.rows) {
          checkAndNotifyReadiness(sponsor.voucher_id, jobFunctionId).catch(err =>
            console.error('[Readiness] Post-vouch check failed:', err.message)
          )
        }

      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[/api/submit-vouch error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    } finally {
      client.release()
    }
    return
  }

  // ─── Get talent recommendations for a user (auth required) ────────
  if (req.method === 'GET' && req.url.startsWith('/api/talent/')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`)
      const pathPart = urlObj.pathname.split('/api/talent/')[1]
      const slug = pathPart?.toLowerCase()
      const fnSlug = urlObj.searchParams.get('fn') || null

      if (!slug) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Slug is required' }))
        return
      }

      // Require auth
      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }

      const linkedinUrl = `https://linkedin.com/in/${slug}`

      // Verify session user matches the slug
      if (session.linkedin_url !== linkedinUrl) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      const userId = session.id

      // Resolve job function filter
      let jobFunctionId = null
      if (fnSlug) {
        const fnRes = await query('SELECT id FROM job_functions WHERE slug = $1', [fnSlug])
        if (fnRes.rows.length > 0) jobFunctionId = fnRes.rows[0].id
      }

      // Fetch scoring settings
      const scoringRes = await query(
        "SELECT key, value FROM app_settings WHERE key IN ('cross_function_discount', 'sibling_coefficient')"
      )
      const scoringSettings = Object.fromEntries(scoringRes.rows.map(r => [r.key, r.value]))
      const crossFunctionDiscount = parseFloat(scoringSettings.cross_function_discount) || 0.5
      const siblingCoefficient = parseFloat(scoringSettings.sibling_coefficient) || 0.8

      // Get talent recommendations from the graph
      const talent = await getTalentRecommendations(userId, jobFunctionId, {
        crossFunctionDiscount,
        siblingCoefficient,
      })

      // Get user's vouches grouped by job function, with invite status per vouchee
      const vouchesRes = await query(`
        SELECT v.job_function_id, jf.name AS jf_name, jf.slug AS jf_slug, jf.practitioner_label AS jf_practitioner_label,
               p.id AS person_id, p.display_name AS name, p.linkedin_url AS linkedin,
               CASE
                 WHEN EXISTS (
                   SELECT 1 FROM vouches v2
                   WHERE v2.voucher_id = v.vouchee_id AND v2.job_function_id = v.job_function_id
                 ) THEN 'completed'
                 ELSE 'pending'
               END AS invite_status
        FROM vouches v
        JOIN people p ON p.id = v.vouchee_id
        JOIN job_functions jf ON jf.id = v.job_function_id
        WHERE v.voucher_id = $1
        ORDER BY jf.display_order, v.created_at
      `, [userId])

      // Group vouches by job function
      const myVouches = {}
      for (const row of vouchesRes.rows) {
        const key = row.jf_slug
        if (!myVouches[key]) {
          myVouches[key] = { name: row.jf_name, slug: row.jf_slug, id: row.job_function_id, practitionerLabel: row.jf_practitioner_label, vouches: [] }
        }
        myVouches[key].vouches.push({
          personId: row.person_id,
          name: row.name,
          linkedin: row.linkedin,
          inviteStatus: row.invite_status,
        })
      }

      // Get distinct job functions the user has vouched in
      const activeJobFunctions = Object.values(myVouches).map(fn => ({
        id: fn.id, name: fn.name, slug: fn.slug, practitionerLabel: fn.practitionerLabel,
      }))

      // Find all functions with talent reachable through user's full network
      // Matches the graph query's 3-degree reach: degree1, degree2 (direct + siblings), degree3
      const reachableRes = await query(`
        WITH
          degree1 AS (
            SELECT DISTINCT vouchee_id AS person_id FROM vouches WHERE voucher_id = $1
          ),
          sponsors AS (
            SELECT DISTINCT voucher_id AS person_id FROM vouches WHERE vouchee_id = $1
          ),
          siblings AS (
            SELECT DISTINCT v.vouchee_id AS person_id
            FROM sponsors s
            JOIN vouches v ON v.voucher_id = s.person_id
            WHERE v.vouchee_id != $1
              AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          ),
          degree2_direct AS (
            SELECT DISTINCT v.vouchee_id AS person_id
            FROM degree1 d1
            JOIN vouches v ON v.voucher_id = d1.person_id
            WHERE v.vouchee_id != $1
              AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          ),
          degree2 AS (
            SELECT person_id FROM degree2_direct
            UNION
            SELECT person_id FROM siblings
          ),
          degree3 AS (
            SELECT DISTINCT v.vouchee_id AS person_id
            FROM degree2 d2
            JOIN vouches v ON v.voucher_id = d2.person_id
            WHERE v.vouchee_id != $1
              AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
              AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
          ),
          network_vouchers AS (
            SELECT $1::int AS person_id
            UNION SELECT person_id FROM degree1
            UNION SELECT person_id FROM degree2
            UNION SELECT person_id FROM degree3
          )
        SELECT DISTINCT jf.id, jf.name, jf.slug, jf.practitioner_label, jf.display_order
        FROM vouches v
        JOIN job_functions jf ON jf.id = v.job_function_id
        WHERE v.voucher_id IN (SELECT person_id FROM network_vouchers)
        ORDER BY jf.display_order
      `, [userId])
      const reachableFunctions = reachableRes.rows.map(f => ({
        id: f.id, name: f.name, slug: f.slug, practitionerLabel: f.practitioner_label,
      }))

      // Get all job functions, marking which ones are available (not yet vouched in)
      const allFnRes = await query('SELECT id, name, slug, practitioner_label FROM job_functions ORDER BY display_order')
      const activeSlugs = new Set(activeJobFunctions.map(f => f.slug))
      const availableJobFunctions = allFnRes.rows
        .filter(f => !activeSlugs.has(f.slug))
        .map(f => ({ id: f.id, name: f.name, slug: f.slug, practitionerLabel: f.practitioner_label }))

      // Batch fetch pending vouch invite tokens for all active functions
      const activeFnIds = activeJobFunctions.map(f => f.id)
      const vouchTokens = {}
      if (activeFnIds.length > 0) {
        const tokensRes = await query(`
          SELECT DISTINCT ON (job_function_id) job_function_id, token
          FROM vouch_invites
          WHERE invitee_id = $1 AND job_function_id = ANY($2) AND status = 'pending'
          ORDER BY job_function_id, created_at DESC
        `, [userId, activeFnIds])

        const foundFnIds = new Set()
        for (const row of tokensRes.rows) {
          const fnSlugKey = activeJobFunctions.find(f => f.id === row.job_function_id)?.slug
          if (fnSlugKey) {
            vouchTokens[fnSlugKey] = row.token
            foundFnIds.add(row.job_function_id)
          }
        }

        // Create self-referencing invites for functions without pending tokens
        for (const fnData of Object.values(myVouches)) {
          if (!foundFnIds.has(fnData.id)) {
            const newToken = crypto.randomUUID()
            await query(
              `INSERT INTO vouch_invites (token, inviter_id, invitee_id, job_function_id) VALUES ($1, $2, $3, $4)`,
              [newToken, userId, userId, fnData.id]
            )
            vouchTokens[fnData.slug] = newToken
          }
        }
      }

      // Count distinct vouchers who have contributed to this user's network
      const contributorsRes = await query(`
        SELECT COUNT(DISTINCT voucher_id) AS count
        FROM vouches
        WHERE voucher_id != $1
          AND vouchee_id IN (
            SELECT vouchee_id FROM vouches WHERE voucher_id = $1
          )
          ${jobFunctionId ? 'AND job_function_id = $2' : ''}
      `, jobFunctionId ? [userId, jobFunctionId] : [userId])
      const contributorCount = Number(contributorsRes.rows[0]?.count || 0)

      res.writeHead(200)
      res.end(JSON.stringify({
        user: { name: session.display_name, linkedin: linkedinUrl },
        talent,
        myVouches,
        vouchTokens,
        activeJobFunctions,
        reachableFunctions,
        availableJobFunctions,
        contributorCount,
      }))
    } catch (err) {
      console.error('[/api/talent error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error', talent: [] }))
    }
    return
  }

  // ─── Admin: get degree coefficients ────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/admin/coefficients') {
    if (!requireAdmin(req, res)) return
    try {
      const result = await query('SELECT degree, coefficient FROM degree_coefficients ORDER BY degree')
      res.writeHead(200)
      res.end(JSON.stringify({ coefficients: result.rows }))
    } catch (err) {
      console.error('[/api/admin/coefficients GET error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: update degree coefficients ─────────────────────────────
  if (req.method === 'PUT' && req.url === '/api/admin/coefficients') {
    if (!requireAdmin(req, res)) return
    try {
      const body = await readBody(req)
      const { coefficients } = body

      if (!Array.isArray(coefficients)) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'coefficients array is required' }))
        return
      }

      for (const { degree, coefficient } of coefficients) {
        if (degree < 1 || degree > 3) continue
        await query(
          'UPDATE degree_coefficients SET coefficient = $1 WHERE degree = $2',
          [coefficient, degree]
        )
      }

      const result = await query('SELECT degree, coefficient FROM degree_coefficients ORDER BY degree')
      res.writeHead(200)
      res.end(JSON.stringify({ coefficients: result.rows }))
    } catch (err) {
      console.error('[/api/admin/coefficients PUT error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: get app settings ───────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/admin/settings') {
    if (!requireAdmin(req, res)) return
    try {
      const result = await query('SELECT key, value FROM app_settings ORDER BY key')
      const settings = {}
      for (const row of result.rows) settings[row.key] = row.value
      res.writeHead(200)
      res.end(JSON.stringify({ settings }))
    } catch (err) {
      console.error('[/api/admin/settings GET error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: update app settings ────────────────────────────────────
  if (req.method === 'PUT' && req.url === '/api/admin/settings') {
    if (!requireAdmin(req, res)) return
    try {
      const body = await readBody(req)
      const { settings } = body
      if (!settings || typeof settings !== 'object') {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'settings object is required' }))
        return
      }
      for (const [key, value] of Object.entries(settings)) {
        await query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, String(value)]
        )
      }
      const result = await query('SELECT key, value FROM app_settings ORDER BY key')
      const updated = {}
      for (const row of result.rows) updated[row.key] = row.value
      res.writeHead(200)
      res.end(JSON.stringify({ settings: updated }))
    } catch (err) {
      console.error('[/api/admin/settings PUT error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: get email templates ────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/admin/email-templates') {
    if (!requireAdmin(req, res)) return
    try {
      const result = await query(
        'SELECT template_key, subject, body_html, available_vars, updated_at FROM email_templates ORDER BY template_key'
      )
      res.writeHead(200)
      res.end(JSON.stringify({ templates: result.rows }))
    } catch (err) {
      console.error('[/api/admin/email-templates GET error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: update email templates ─────────────────────────────────
  if (req.method === 'PUT' && req.url === '/api/admin/email-templates') {
    if (!requireAdmin(req, res)) return
    try {
      const body = await readBody(req)
      const { templates } = body
      if (!Array.isArray(templates)) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'templates array is required' }))
        return
      }
      for (const t of templates) {
        if (!t.template_key) continue
        await query(
          `UPDATE email_templates SET subject = $1, body_html = $2, updated_at = NOW() WHERE template_key = $3`,
          [t.subject, t.body_html, t.template_key]
        )
      }
      const result = await query(
        'SELECT template_key, subject, body_html, available_vars, updated_at FROM email_templates ORDER BY template_key'
      )
      res.writeHead(200)
      res.end(JSON.stringify({ templates: result.rows }))
    } catch (err) {
      console.error('[/api/admin/email-templates PUT error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: send nudges ─────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/admin/send-nudges') {
    if (!requireAdmin(req, res)) return
    try {
      const [inviteeResults, voucherResults] = await Promise.all([
        processNudges(),
        processVoucherNudges(),
      ])
      const results = { invitee: inviteeResults, voucher: voucherResults }
      console.log('[Admin] Nudge run results:', results)
      res.writeHead(200)
      res.end(JSON.stringify(results))
    } catch (err) {
      console.error('[/api/admin/send-nudges error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Request login (magic link) ──────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/request-login') {
    if (isRateLimited(req)) {
      // Still return 200 to not reveal rate limiting to attackers
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true }))
      return
    }
    try {
      const body = await readBody(req)
      const { identifier } = body

      if (!identifier?.trim()) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'identifier is required' }))
        return
      }

      const trimmed = identifier.trim()

      // Determine if it's a LinkedIn URL or email
      let person = null
      if (trimmed.includes('linkedin.com')) {
        const normalized = normalizeLinkedInUrl(trimmed)
        if (normalized) {
          const result = await query(
            'SELECT id, display_name, email, linkedin_url FROM people WHERE linkedin_url = $1',
            [normalized]
          )
          person = result.rows[0] || null
        }
      } else {
        // Treat as email
        const result = await query(
          'SELECT id, display_name, email, linkedin_url FROM people WHERE LOWER(email) = LOWER($1)',
          [trimmed]
        )
        person = result.rows[0] || null
      }

      // Always return ok (don't reveal existence)
      if (person && person.email) {
        const loginToken = crypto.randomUUID()
        await query(
          `INSERT INTO login_tokens (token, person_id, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
          [loginToken, person.id]
        )

        const slug = person.linkedin_url.split('/in/')[1]
        const resendId = await sendLoginLinkEmail(person, slug, loginToken)
        await query(
          `INSERT INTO sent_emails (recipient_id, email_type, resend_id)
           VALUES ($1, 'login_link', $2)`,
          [person.id, resendId]
        )
        console.log(`[Auth] Login link sent to ${person.display_name}`)
        trackEvent(String(person.id), 'login_requested', { person_id: person.id, method: trimmed.includes('linkedin.com') ? 'linkedin' : 'email' })
      } else {
        console.log(`[Auth] Login request for unknown identifier: ${trimmed}`)
      }

      res.writeHead(200)
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      console.error('[/api/request-login error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Validate login token (magic link click) ──────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/auth/validate')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`)
      const loginToken = urlObj.searchParams.get('token')

      if (!loginToken) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'token is required' }))
        return
      }

      // Validate token
      const tokenRes = await query(
        `SELECT id, person_id FROM login_tokens WHERE token = $1 AND expires_at > NOW()`,
        [loginToken]
      )

      if (tokenRes.rows.length === 0) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Invalid or expired token' }))
        return
      }

      const tokenRow = tokenRes.rows[0]

      // Mark as used (for audit, not single-use enforcement)
      await query('UPDATE login_tokens SET used_at = NOW() WHERE id = $1', [tokenRow.id])

      // Look up person
      const personRes = await query(
        'SELECT id, display_name, linkedin_url, email FROM people WHERE id = $1',
        [tokenRow.person_id]
      )
      const person = personRes.rows[0]

      // Create session (30-day expiry)
      const sessionToken = crypto.randomUUID()
      await query(
        `INSERT INTO sessions (token, person_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [sessionToken, person.id]
      )

      // Set httpOnly cookie
      res.setHeader('Set-Cookie',
        `vf_session=${sessionToken}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`
      )

      identifyPerson(String(person.id), { name: person.display_name })
      trackEvent(String(person.id), 'login_completed', { person_id: person.id })

      res.writeHead(200)
      res.end(JSON.stringify({
        user: {
          id: person.id,
          name: person.display_name,
          linkedin: person.linkedin_url,
          email: person.email,
        },
      }))
    } catch (err) {
      console.error('[/api/auth/validate error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Check existing session ───────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/auth/session') {
    try {
      const person = await validateSession(req)

      if (!person) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'No valid session' }))
        return
      }

      res.writeHead(200)
      res.end(JSON.stringify({
        user: {
          id: person.id,
          name: person.display_name,
          linkedin: person.linkedin_url,
          email: person.email,
        },
      }))
    } catch (err) {
      console.error('[/api/auth/session error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // Not an API route — try serving static files (production)
  if (fs.existsSync(DIST_DIR)) {
    if (serveStaticFile(req, res)) return

    // SPA fallback: serve index.html for client-side routes
    const indexPath = path.join(DIST_DIR, 'index.html')
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
      res.end(fs.readFileSync(indexPath))
      return
    }
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`)
})

// ─── Auto-run nudges every 6 hours ───────────────────────────────
setInterval(async () => {
  console.log('[Nudge] Starting scheduled nudge run...')
  try {
    const [inviteeResults, voucherResults] = await Promise.all([
      processNudges(),
      processVoucherNudges(),
    ])
    console.log('[Nudge] Scheduled run complete:', { invitee: inviteeResults, voucher: voucherResults })
  } catch (err) {
    console.error('[Nudge] Scheduled run failed:', err.message)
  }
}, 6 * 60 * 60 * 1000)

// Flush PostHog events on shutdown
process.on('SIGTERM', async () => {
  await posthogShutdown()
  process.exit(0)
})
process.on('SIGINT', async () => {
  await posthogShutdown()
  process.exit(0)
})
