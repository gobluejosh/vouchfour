import './lib/env.js'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, getClient } from './lib/db.js'
import { normalizeLinkedInUrl } from './lib/linkedin.js'
import { getTalentRecommendations, getVouchPaths } from './lib/graph.js'
import { sendVouchInviteEmail, sendLoginLinkEmail, sendEmail, loadTemplate, applyVariables, emailLayout, isUnsubscribed, getRecipient } from './lib/email.js'
import { processNudges, processVoucherNudges } from './lib/nudge.js'
import { trackEvent, identifyPerson, shutdown as posthogShutdown } from './lib/posthog.js'
import { enrichPerson, enrichBatch, saveApolloData } from './lib/enrich.js'

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
const DAILY_EMAIL_CAP_DEFAULT = 10

async function canEmailRecipient(recipientId) {
  const cap = await getQuickAskLimit('daily_email_cap', DAILY_EMAIL_CAP_DEFAULT)
  const result = await query(
    `SELECT COUNT(*) AS cnt FROM sent_emails
     WHERE recipient_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`,
    [recipientId]
  )
  return Number(result.rows[0].cnt) < cap
}

// ─── Quick Ask rate limiting ─────────────────────────────────────
async function getQuickAskLimit(key, defaultVal = 3) {
  const result = await query('SELECT value FROM app_settings WHERE key = $1', [key])
  return Number(result.rows[0]?.value) || defaultVal
}

async function countSenderAsksThisWeek(senderId) {
  const result = await query(
    `SELECT COUNT(*) AS cnt FROM quick_ask_recipients
     WHERE ask_id IN (SELECT id FROM quick_asks WHERE sender_id = $1)
       AND status = 'sent' AND sent_at > NOW() - INTERVAL '7 days'`,
    [senderId]
  )
  return Number(result.rows[0].cnt)
}

async function countRecipientReceivesThisWeek(recipientId) {
  const result = await query(
    `SELECT COUNT(*) AS cnt FROM quick_ask_recipients
     WHERE recipient_id = $1 AND status = 'sent' AND sent_at > NOW() - INTERVAL '7 days'`,
    [recipientId]
  )
  return Number(result.rows[0].cnt)
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
    `SELECT s.person_id, p.id, p.display_name, p.linkedin_url, p.email,
            p.current_title, p.current_company, p.photo_url
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

  // ─── Client error reporting ───────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/client-error') {
    try {
      const body = await readBody(req)
      const { message, stack, context, url, userAgent } = body
      const session = await validateSession(req)
      const userId = session?.id || null
      console.error('[CLIENT ERROR]', JSON.stringify({
        userId,
        message,
        stack,
        context,
        url,
        userAgent,
        timestamp: new Date().toISOString(),
      }))
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      console.error('[client-error endpoint]', err)
      res.writeHead(200) // don't fail on error reporting
      res.end(JSON.stringify({ ok: true }))
    }
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

            // Fire-and-forget: save full Apollo response for enrichment pipeline
            if (person && normalizedUrl) {
              ;(async () => {
                try {
                  const pRes = await query('SELECT id, display_name FROM people WHERE linkedin_url = $1', [normalizedUrl])
                  if (pRes.rows[0]) {
                    await saveApolloData(pRes.rows[0].id, pRes.rows[0].display_name, apolloData)
                    console.log(`[Email] Apollo data saved for enrichment: ${pRes.rows[0].display_name}`)
                  }
                } catch (err) {
                  console.warn(`[Email] Failed to save Apollo enrichment data:`, err.message)
                }
              })()
            }

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

        // ── Post-commit: send invite emails + trigger enrichment ──

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

        // ── Fire-and-forget: enrich newly created people ──
        ;(async () => {
          await sleep(2000) // Let the dust settle after form submission
          const toEnrich = vouchedPeople.filter(v => v.isNew).map(v => v.id)
          if (toEnrich.length === 0) return
          console.log(`[Enrich] Queuing enrichment for ${toEnrich.length} new people from vouch submission`)
          for (const personId of toEnrich) {
            try {
              await enrichPerson(personId)
            } catch (err) {
              console.error(`[Enrich] Post-vouch enrichment failed for ${personId}:`, err.message)
            }
            await sleep(2000)
          }
        })()


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
        user: { id: session.id, name: session.display_name, linkedin: linkedinUrl },
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

  // ─── Update own profile (auth required) ────────────────────────────
  if (req.method === 'PUT' && req.url.startsWith('/api/person/')) {
    try {
      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }

      const personId = Number(req.url.split('/api/person/')[1])
      if (!personId || isNaN(personId)) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid person ID' }))
        return
      }

      // Only allow editing your own profile
      if (session.id !== personId) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Can only edit your own profile' }))
        return
      }

      const body = await readBody(req)

      // Profile info update (name, linkedin_url, email)
      if (body.type === 'profile') {
        const updates = []
        const params = []
        let idx = 1

        if (body.display_name !== undefined) {
          updates.push(`display_name = $${idx++}`)
          params.push(body.display_name.trim())
        }
        if (body.linkedin_url !== undefined) {
          const normalized = normalizeLinkedInUrl(body.linkedin_url.trim())
          updates.push(`linkedin_url = $${idx++}`)
          params.push(normalized || body.linkedin_url.trim())
        }
        if (body.email !== undefined) {
          updates.push(`email = $${idx++}`)
          params.push(body.email.trim().toLowerCase() || null)
        }

        if (updates.length === 0) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'No fields to update' }))
          return
        }

        params.push(personId)
        await query(
          `UPDATE people SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
          params
        )

        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        return
      }

      // AI summary update
      if (body.type === 'summary') {
        const newSummary = (body.ai_summary || '').trim()
        if (!newSummary) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Summary cannot be empty' }))
          return
        }

        await query(`
          INSERT INTO person_enrichment (person_id, source, raw_payload, ai_summary, enriched_at)
          VALUES ($1, 'claude', '{"manual_edit": true}', $2, NOW())
          ON CONFLICT (person_id, source) DO UPDATE
          SET ai_summary = EXCLUDED.ai_summary, enriched_at = NOW()
        `, [personId, newSummary])

        // Also generate updated compact summary
        try {
          const compactRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 128,
              system: 'Compress this professional summary into 1-2 sentences (max 40 words). Include: current role + company, 1-2 key career highlights. Drop: education, LinkedIn metrics, generic descriptors. Output ONLY the compressed summary, nothing else.',
              messages: [{ role: 'user', content: newSummary }],
            }),
          })
          const compactData = await compactRes.json()
          const compactSummary = (compactData.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
          if (compactSummary) {
            await query(`
              INSERT INTO person_enrichment (person_id, source, raw_payload, ai_summary, enriched_at)
              VALUES ($1, 'claude-compact', '{}', $2, NOW())
              ON CONFLICT (person_id, source) DO UPDATE
              SET ai_summary = EXCLUDED.ai_summary, enriched_at = NOW()
            `, [personId, compactSummary])
          }
        } catch (compactErr) {
          console.warn(`[Profile] Compact summary regen failed for ${personId}:`, compactErr.message)
        }

        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
        return
      }

      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Invalid update type. Use "profile" or "summary".' }))
    } catch (err) {
      console.error('[/api/person PUT error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Person detail (auth required) ─────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/person/')) {
    try {
      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }

      const personId = Number(req.url.split('/api/person/')[1])
      if (!personId || isNaN(personId)) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid person ID' }))
        return
      }

      // Fetch person with all enrichment fields
      const personRes = await query(`
        SELECT id, display_name, linkedin_url, email, current_title, current_company,
               location, seniority, industry, headline, photo_url, enriched_at
        FROM people WHERE id = $1
      `, [personId])

      if (personRes.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Person not found' }))
        return
      }
      const person = personRes.rows[0]

      // Fetch AI summary, employment history, and brave web mentions in parallel
      const [summaryRes, historyRes, braveRes, degreeRes] = await Promise.all([
        query(`
          SELECT ai_summary FROM person_enrichment
          WHERE person_id = $1 AND source = 'claude'
        `, [personId]),
        query(`
          SELECT organization, title, start_date, end_date, is_current
          FROM employment_history
          WHERE person_id = $1
          ORDER BY is_current DESC, start_date DESC NULLS LAST
        `, [personId]),
        query(`
          SELECT raw_payload FROM person_enrichment
          WHERE person_id = $1 AND source = 'brave'
        `, [personId]),
        // Find connection degree relative to the requesting user
        query(`
          WITH degree1 AS (
            SELECT DISTINCT vouchee_id AS person_id FROM vouches WHERE voucher_id = $1
          ),
          sponsors AS (
            SELECT DISTINCT voucher_id FROM vouches WHERE vouchee_id = $1
          ),
          siblings AS (
            SELECT DISTINCT v.vouchee_id AS person_id
            FROM sponsors s JOIN vouches v ON v.voucher_id = s.voucher_id
            WHERE v.vouchee_id != $1 AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
          ),
          degree2 AS (
            SELECT DISTINCT v.vouchee_id AS person_id
            FROM degree1 d1 JOIN vouches v ON v.voucher_id = d1.person_id
            WHERE v.vouchee_id != $1 AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
            UNION SELECT person_id FROM siblings
          ),
          degree3 AS (
            SELECT DISTINCT v.vouchee_id AS person_id
            FROM degree2 d2 JOIN vouches v ON v.voucher_id = d2.person_id
            WHERE v.vouchee_id != $1
              AND v.vouchee_id NOT IN (SELECT person_id FROM degree1)
              AND v.vouchee_id NOT IN (SELECT person_id FROM degree2)
          )
          SELECT CASE
            WHEN $2 = $1 THEN 0
            WHEN $2 IN (SELECT person_id FROM degree1) THEN 1
            WHEN $2 IN (SELECT person_id FROM degree2) THEN 2
            WHEN $2 IN (SELECT person_id FROM degree3) THEN 3
            ELSE NULL
          END AS degree
        `, [session.id, personId]),
      ])

      // Extract brave web mentions (titles + descriptions from search results)
      let webMentions = []
      if (braveRes.rows.length > 0) {
        const braveData = braveRes.rows[0].raw_payload
        const allResults = [...(braveData.results1 || []), ...(braveData.results2 || [])]
        const seen = new Set()
        for (const r of allResults) {
          if (seen.has(r.url)) continue
          seen.add(r.url)
          // Filter out generic LinkedIn/ZoomInfo/Apollo results
          if (/linkedin\.com|zoominfo\.com|apollo\.io|rocketreach|signalhire/i.test(r.url)) continue
          webMentions.push({ title: r.title || '', description: r.description || '', url: r.url || '' })
        }
        webMentions = webMentions.slice(0, 6)
      }

      // Compute vouch path with photo URLs and recommendation directions
      // Uses bidirectional BFS for path display. Flags degree_mismatch when the
      // path hop count doesn't match the degree (e.g. 1-hop reverse path for a 3rd degree person).
      const computedDegree = degreeRes.rows[0]?.degree ?? null
      let intermediary_name = null
      let vouch_path = null
      let degree_mismatch = false
      if (computedDegree >= 1) {
        try {
          const pathMap = await getVouchPaths(Number(session.id), [Number(personId)])
          const rawPath = pathMap.get(Number(personId))
          if (rawPath && rawPath.length >= 2) {
            degree_mismatch = (rawPath.length - 1) !== computedDegree
            intermediary_name = rawPath.length >= 3 ? rawPath[1].name : null

            // Load photo URLs + vouch directions for path members
            const pathIds = rawPath.map(p => p.id)
            const [photoRes2, vouchDirRes] = await Promise.all([
              query('SELECT id, photo_url FROM people WHERE id = ANY($1)', [pathIds]),
              query(
                'SELECT DISTINCT voucher_id, vouchee_id FROM vouches WHERE voucher_id = ANY($1) AND vouchee_id = ANY($1)',
                [pathIds]
              ),
            ])

            const photoMap = new Map()
            for (const row of photoRes2.rows) photoMap.set(row.id, row.photo_url)

            const vouchSet = new Set()
            for (const row of vouchDirRes.rows) vouchSet.add(`${row.voucher_id}->${row.vouchee_id}`)

            vouch_path = rawPath.map((p, i) => {
              const node = { id: p.id, name: p.name, photo_url: photoMap.get(p.id) || null }
              if (i < rawPath.length - 1) {
                const nextId = rawPath[i + 1].id
                node.recommends_next = vouchSet.has(`${p.id}->${nextId}`)
                node.recommended_by_next = vouchSet.has(`${nextId}->${p.id}`)
              }
              return node
            })
          }
        } catch (e) { /* non-critical */ }
      }

      res.writeHead(200)
      res.end(JSON.stringify({
        person: {
          id: person.id,
          name: person.display_name,
          linkedin_url: person.linkedin_url,
          email: Number(session.id) === Number(personId) ? (person.email || null) : undefined,
          current_title: person.current_title,
          current_company: person.current_company,
          location: person.location,
          industry: person.industry,
          headline: person.headline,
          photo_url: person.photo_url,
        },
        degree: computedDegree,
        degree_mismatch,
        intermediary_name,
        vouch_path,
        ai_summary: summaryRes.rows[0]?.ai_summary || null,
        employment_history: historyRes.rows,
        web_mentions: webMentions,
        is_self: Number(session.id) === Number(personId),
      }))
    } catch (err) {
      console.error('[/api/person error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
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

  // ─── Admin: enrichment review queue ──────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/admin/enrichment-queue')) {
    if (!requireAdmin(req, res)) return
    try {
      const url = new URL(req.url, `http://${req.headers.host}`)
      const status = url.searchParams.get('status') || 'all'

      let whereClause = 'WHERE p.enriched_at IS NOT NULL'
      const params = []
      if (status !== 'all') {
        params.push(status)
        whereClause += ` AND p.review_status = $${params.length}`
      }

      const result = await query(`
        SELECT
          p.id, p.display_name, p.photo_url, p.current_title, p.current_company,
          p.linkedin_url, p.enriched_at, p.review_status, p.review_notes, p.reviewed_at,
          pe_compact.ai_summary AS compact_summary,
          pe_claude.ai_summary AS ai_summary
        FROM people p
        LEFT JOIN person_enrichment pe_compact
          ON pe_compact.person_id = p.id AND pe_compact.source = 'claude-compact'
        LEFT JOIN person_enrichment pe_claude
          ON pe_claude.person_id = p.id AND pe_claude.source = 'claude'
        ${whereClause}
        ORDER BY p.enriched_at DESC
      `, params)

      // Get counts for filter badges
      const countsRes = await query(`
        SELECT
          COUNT(*) FILTER (WHERE review_status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE review_status = 'approved') AS approved,
          COUNT(*) FILTER (WHERE review_status = 'flagged') AS flagged,
          COUNT(*) AS total
        FROM people WHERE enriched_at IS NOT NULL
      `)

      res.writeHead(200)
      res.end(JSON.stringify({
        people: result.rows,
        counts: countsRes.rows[0],
      }))
    } catch (err) {
      console.error('[/api/admin/enrichment-queue error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Admin: update enrichment review status ─────────────────────
  if (req.method === 'PUT' && req.url === '/api/admin/enrichment-review') {
    if (!requireAdmin(req, res)) return
    try {
      const body = await readBody(req)
      const { person_id, status, notes } = body

      if (!person_id || !['approved', 'flagged', 'pending'].includes(status)) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'person_id and valid status (approved/flagged/pending) required' }))
        return
      }

      await query(`
        UPDATE people
        SET review_status = $2, review_notes = $3, reviewed_at = NOW()
        WHERE id = $1
      `, [person_id, status, notes || null])

      // Auto re-enrich when flagged (runs in background, doesn't block response)
      if (status === 'flagged') {
        enrichPerson(person_id)
          .then(result => console.log(`[Review] Auto re-enrichment complete for person ${person_id}:`, JSON.stringify(result.steps)))
          .catch(err => console.error(`[Review] Auto re-enrichment failed for person ${person_id}:`, err.message))
      }

      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, person_id, status }))
    } catch (err) {
      console.error('[/api/admin/enrichment-review error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Enrichment trigger (no auth, tucked away) ───────────────────
  if (req.method === 'POST' && req.url === '/api/enrich') {
    try {
      const body = await readBody(req)

      // Mode 1: single person
      if (body.person_id) {
        const personId = Number(body.person_id)
        if (!personId || isNaN(personId)) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'Invalid person_id' }))
          return
        }
        enrichPerson(personId).catch(err =>
          console.error(`[Enrich] Failed for person ${personId}:`, err.message)
        )
        res.writeHead(200)
        res.end(JSON.stringify({ status: 'started', person_id: personId }))
        return
      }

      // Mode 2: batch all un-enriched
      if (body.all === true) {
        const unenrichedRes = await query(
          'SELECT id FROM people WHERE enriched_at IS NULL ORDER BY created_at ASC'
        )
        const personIds = unenrichedRes.rows.map(r => r.id)
        console.log(`[Enrich] Batch started: ${personIds.length} un-enriched people`)

        enrichBatch(personIds).catch(err =>
          console.error('[Enrich] Batch failed:', err.message)
        )

        res.writeHead(200)
        res.end(JSON.stringify({ status: 'started', count: personIds.length }))
        return
      }

      // Mode 3: re-enrich people missing Claude AI summaries
      if (body.missing_summaries === true) {
        const missingRes = await query(`
          SELECT p.id FROM people p
          LEFT JOIN person_enrichment pe ON pe.person_id = p.id AND pe.source = 'claude'
          WHERE pe.ai_summary IS NULL OR pe.id IS NULL
          ORDER BY p.created_at ASC
        `)
        const personIds = missingRes.rows.map(r => r.id)
        console.log(`[Enrich] Re-enrich started: ${personIds.length} people missing AI summaries`)

        enrichBatch(personIds).catch(err =>
          console.error('[Enrich] Re-enrich batch failed:', err.message)
        )

        res.writeHead(200)
        res.end(JSON.stringify({ status: 'started', count: personIds.length, mode: 'missing_summaries' }))
        return
      }

      res.writeHead(400)
      res.end(JSON.stringify({ error: 'Provide person_id or { "all": true }' }))
    } catch (err) {
      console.error('[/api/enrich error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Network Brain query (session auth, tucked away) ────────────
  if (req.method === 'POST' && req.url === '/api/network-brain') {
    try {
      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }

      const body = await readBody(req)
      const question = body.question?.trim()
      if (!question) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'question is required' }))
        return
      }

      const userId = session.id
      console.log(`[NetworkBrain] Query from ${session.display_name}: "${question.slice(0, 80)}"`)
      const start = Date.now()

      // Get user's full network (all functions)
      const talent = await getTalentRecommendations(userId, null)

      if (talent.length === 0) {
        res.writeHead(200)
        res.end(JSON.stringify({
          answer: 'Your network doesn\'t have enough data yet. Once your connections respond to their vouch invites, I\'ll be able to help you find the right people.',
          people: [],
        }))
        return
      }

      // Pull enrichment summaries + structured fields for all network people
      const personIds = talent.map(t => t.id)

      const [enrichmentRes, structuredRes, userProfileRes, userSummaryRes, userHistoryRes] = await Promise.all([
        query(`
          SELECT DISTINCT ON (person_id) person_id, ai_summary FROM person_enrichment
          WHERE person_id = ANY($1) AND source IN ('claude-compact', 'claude') AND ai_summary IS NOT NULL
          ORDER BY person_id, CASE source WHEN 'claude-compact' THEN 0 ELSE 1 END
        `, [personIds]),
        query(`
          SELECT id, display_name, current_title, current_company, industry, linkedin_url, photo_url
          FROM people WHERE id = ANY($1)
        `, [personIds]),
        // User's own profile
        query(`
          SELECT id, display_name, current_title, current_company, location, industry, headline
          FROM people WHERE id = $1
        `, [userId]),
        query(`
          SELECT ai_summary FROM person_enrichment
          WHERE person_id = $1 AND source = 'claude'
        `, [userId]),
        query(`
          SELECT organization, title, is_current FROM employment_history
          WHERE person_id = $1 ORDER BY start_date DESC NULLS LAST
        `, [userId]),
      ])

      const summaryMap = new Map()
      for (const row of enrichmentRes.rows) summaryMap.set(row.person_id, row.ai_summary)

      const structuredMap = new Map()
      for (const row of structuredRes.rows) structuredMap.set(row.id, row)

      // Build user's own profile context
      const userProfile = userProfileRes.rows[0]
      const userSummary = userSummaryRes.rows[0]?.ai_summary || ''
      const userHistory = userHistoryRes.rows || []
      let userContext = ''
      if (userProfile) {
        const parts = [`Name: ${userProfile.display_name}`]
        if (userProfile.current_title && userProfile.current_company) parts.push(`Current: ${userProfile.current_title} at ${userProfile.current_company}`)
        if (userProfile.industry) parts.push(`Industry: ${userProfile.industry}`)
        if (userProfile.location) parts.push(`Location: ${userProfile.location}`)
        if (userHistory.length > 0) {
          parts.push(`Career history: ${userHistory.map(j => `${j.title || 'Role'} at ${j.organization}${j.is_current ? ' (current)' : ''}`).join(' → ')}`)
        }
        if (userSummary) parts.push(`Profile: ${userSummary}`)
        userContext = parts.join('\n')
      }

      // Build network context for Claude
      const networkContext = talent.map(t => {
        const s = structuredMap.get(t.id)
        const summary = summaryMap.get(t.id) || ''
        const parts = [`- ${t.display_name}`]
        if (s?.current_title && s?.current_company) parts.push(`| ${s.current_title} at ${s.current_company}`)
        else if (s?.current_company) parts.push(`| ${s.current_company}`)
        if (s?.industry) parts.push(`| ${s.industry}`)
        parts.push(`| Degree ${t.degree}, Score ${t.vouch_score}`)
        if (summary) parts.push(`\n  Profile: ${summary}`)
        return parts.join(' ')
      }).join('\n')

      // Call Claude (no web search — network data IS the context)
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: `You are a professional network advisor. The user has a trusted vouch-based professional network.

About the user asking questions:
${userContext}

Below is data about every person in their network, including their role, company, industry, vouch score (higher = more trusted), degree of connection (1 = direct, 2 = one hop, 3 = two hops), and a brief professional summary where available.

Answer the user's question by recommending specific people from their network. Always reference people by name and explain why they're relevant. You know the user's background, so you can tailor recommendations based on shared experience, complementary skills, or relevant connections. If no one in the network matches, say so honestly. Keep responses to 2-4 short paragraphs. Use bullet points when listing multiple people. Be direct and actionable.

Network (${talent.length} people):
${networkContext}`,
          messages: [{ role: 'user', content: question }],
        }),
      })

      const data = await claudeRes.json()
      const answer = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')

      console.log(`[NetworkBrain] Response in ${Date.now() - start}ms | ${answer.length} chars`)

      // Extract mentioned people for structured response
      const mentionedPeople = talent.filter(t =>
        answer.toLowerCase().includes(t.display_name.toLowerCase())
      ).map(t => ({
        id: t.id,
        name: t.display_name,
        linkedin_url: t.linkedin_url,
        degree: t.degree,
        vouch_score: t.vouch_score,
        current_title: structuredMap.get(t.id)?.current_title || null,
        current_company: structuredMap.get(t.id)?.current_company || null,
        photo_url: structuredMap.get(t.id)?.photo_url || null,
      }))

      res.writeHead(200)
      res.end(JSON.stringify({ answer, people: mentionedPeople }))
    } catch (err) {
      console.error('[/api/network-brain error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Quick Ask: Reply context (for email CTA → person page) ─────
  if (req.method === 'GET' && req.url.match(/^\/api\/quick-ask\/reply-context\/\d+$/)) {
    try {
      const session = await validateSession(req)
      if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      const rowId = Number(req.url.split('/').pop())

      const result = await query(
        `SELECT qar.draft_subject, qar.draft_body, qar.recipient_id,
                qa.question, qa.sender_id,
                p.display_name AS sender_name
         FROM quick_ask_recipients qar
         JOIN quick_asks qa ON qa.id = qar.ask_id
         JOIN people p ON p.id = qa.sender_id
         WHERE qar.id = $1 AND qar.recipient_id = $2 AND qar.status = 'sent'`,
        [rowId, session.id]
      )

      if (!result.rows[0]) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Message not found' })); return
      }

      const row = result.rows[0]
      res.writeHead(200)
      res.end(JSON.stringify({
        sender_name: row.sender_name,
        sender_first_name: row.sender_name.split(' ')[0],
        subject: row.draft_subject,
        message_body: row.draft_body,
        question: row.question,
      }))
    } catch (err) {
      console.error('[/api/quick-ask/reply-context error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Quick Ask: Create reply draft (skip AI, blank fields) ──────
  if (req.method === 'POST' && req.url === '/api/quick-ask/reply-draft') {
    try {
      const session = await validateSession(req)
      if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      const body = await readBody(req)
      const { reply_to_id } = body

      if (!reply_to_id) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'reply_to_id is required' })); return
      }

      // Load the original message — verify current user is the recipient
      const origRes = await query(
        `SELECT qar.recipient_id, qar.draft_body, qar.draft_subject,
                qa.sender_id, qa.question,
                p.display_name AS sender_name, p.current_title AS sender_title,
                p.current_company AS sender_company, p.photo_url AS sender_photo,
                p.email AS sender_email
         FROM quick_ask_recipients qar
         JOIN quick_asks qa ON qa.id = qar.ask_id
         JOIN people p ON p.id = qa.sender_id
         WHERE qar.id = $1 AND qar.recipient_id = $2 AND qar.status = 'sent'`,
        [reply_to_id, session.id]
      )

      if (!origRes.rows[0]) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Original message not found' })); return
      }

      const orig = origRes.rows[0]
      const senderId = orig.sender_id

      // Create a quick_ask record for the reply
      const askRes = await query(
        `INSERT INTO quick_asks (sender_id, question) VALUES ($1, $2) RETURNING id`,
        [session.id, `Reply to ${orig.sender_name}`]
      )
      const askId = askRes.rows[0].id

      // Compute vouch path
      const paths = await getVouchPaths(session.id, [senderId])
      const vouchPath = paths.get(senderId) || [{ id: session.id, name: (await query('SELECT display_name FROM people WHERE id=$1', [session.id])).rows[0]?.display_name || 'You' }, { id: senderId, name: orig.sender_name }]
      const degree = vouchPath.length - 1

      // Create draft row with blank subject/body
      const draftRes = await query(
        `INSERT INTO quick_ask_recipients (ask_id, recipient_id, vouch_path, draft_subject, draft_body, knows_recipient)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [askId, senderId, JSON.stringify(vouchPath), '', '']
      )

      const senderTitle = [orig.sender_title, orig.sender_company].filter(Boolean).join(' at ')

      res.writeHead(200)
      res.end(JSON.stringify({
        ask_id: askId,
        drafts: [{
          id: draftRes.rows[0].id,
          recipient_id: senderId,
          recipient_name: orig.sender_name,
          recipient_title: senderTitle,
          recipient_photo_url: orig.sender_photo || null,
          vouch_path: vouchPath,
          draft_subject: '',
          draft_body: '',
          no_email: !orig.sender_email,
          degree,
        }],
      }))
    } catch (err) {
      console.error('[/api/quick-ask/reply-draft error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Vouch Paths: get intermediary names for selected people ────
  if (req.method === 'POST' && req.url === '/api/vouch-paths') {
    try {
      const session = await validateSession(req)
      if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      const body = await readBody(req)
      const { recipient_ids } = body
      if (!Array.isArray(recipient_ids) || recipient_ids.length === 0) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'recipient_ids required' })); return
      }
      const pathMap = await getVouchPaths(session.id, recipient_ids.map(Number))
      const result = {}
      for (const rid of recipient_ids) {
        const path = pathMap.get(Number(rid))
        if (path && path.length >= 2) {
          result[rid] = { intermediary_name: path[1].name, path: path.map(p => p.name) }
        }
      }
      res.writeHead(200)
      res.end(JSON.stringify(result))
    } catch (err) {
      console.error('[/api/vouch-paths error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Quick Ask: Draft outreach messages ─────────────────────────
  if (req.method === 'POST' && req.url === '/api/quick-ask/draft') {
    try {
      const session = await validateSession(req)
      if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      const body = await readBody(req)
      const { question, recipient_ids, recipient_context } = body

      if (!question || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'question and recipient_ids required' })); return
      }

      const maxRecipients = await getQuickAskLimit('quick_ask_max_recipients')
      if (recipient_ids.length > maxRecipients) {
        res.writeHead(400); res.end(JSON.stringify({ error: `Maximum ${maxRecipients} recipients per ask` })); return
      }

      // Check sender rate limit
      const maxSends = await getQuickAskLimit('quick_ask_max_sends_per_week')
      const senderCount = await countSenderAsksThisWeek(session.id)
      if (senderCount >= maxSends) {
        res.writeHead(429); res.end(JSON.stringify({ error: `You've reached your limit of ${maxSends} asks this week. Try again next week.`, asks_remaining: 0 })); return
      }

      // Check sender has email on file (needed for reply-to)
      const senderRes = await query(
        `SELECT p.id, p.display_name, p.email, p.current_title, p.current_company, p.photo_url,
                pe.ai_summary
         FROM people p
         LEFT JOIN person_enrichment pe ON pe.person_id = p.id AND pe.source = 'claude'
         WHERE p.id = $1`, [session.id])
      const sender = senderRes.rows[0]
      if (!sender?.email) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'You need an email address on your profile before sending asks. Update it on your profile page.' })); return
      }

      // Check recipient rate limits + load profiles
      const recipientProfiles = []
      const recipientsAtLimit = []
      for (const rid of recipient_ids) {
        const maxReceives = await getQuickAskLimit('quick_ask_max_receives_per_week')
        const recvCount = await countRecipientReceivesThisWeek(rid)
        if (recvCount >= maxReceives) {
          recipientsAtLimit.push(rid)
          continue
        }
        const rRes = await query(
          `SELECT p.id, p.display_name, p.email, p.current_title, p.current_company, p.photo_url,
                  pe.ai_summary
           FROM people p
           LEFT JOIN person_enrichment pe ON pe.person_id = p.id AND pe.source = 'claude'
           WHERE p.id = $1`, [rid])
        if (rRes.rows[0]) recipientProfiles.push(rRes.rows[0])
      }

      if (recipientProfiles.length === 0) {
        res.writeHead(429); res.end(JSON.stringify({ error: 'All selected recipients have reached their receive limit this week.', recipients_at_limit: recipientsAtLimit })); return
      }

      // Compute vouch paths
      const paths = await getVouchPaths(session.id, recipientProfiles.map(r => r.id))

      // Create the ask record
      const askRes = await query(
        'INSERT INTO quick_asks (sender_id, question) VALUES ($1, $2) RETURNING id',
        [session.id, question]
      )
      const askId = askRes.rows[0].id

      // Draft messages via Claude for each recipient
      const drafts = []
      const senderFirst = sender.display_name.split(' ')[0]
      const senderSummary = (sender.ai_summary || '').split('.').slice(0, 2).join('.') + '.'

      for (const recipient of recipientProfiles) {
        const vouchPath = paths.get(recipient.id) || [
          { id: sender.id, name: sender.display_name },
          { id: recipient.id, name: recipient.display_name }
        ]
        const recipientFirst = recipient.display_name.split(' ')[0]
        const recipientSummary = (recipient.ai_summary || '').split('.').slice(0, 2).join('.') + '.'

        // Build chain text for the prompt
        const chainText = vouchPath.map(p => p.name).join(' → ')
        const degree = vouchPath.length - 1

        // Build relationship context for this recipient
        const ctx = recipient_context?.[String(recipient.id)] || {}
        let relationshipNote = ''
        if (degree === 1) {
          relationshipNote = `Relationship: The sender and recipient already know each other — they've directly vouched for one another in the VouchFour network. Write as if emailing someone you know, not a stranger.`
        } else if (ctx.knows_them && ctx.relationship) {
          relationshipNote = `Relationship: The sender already knows the recipient. Context from sender: "${ctx.relationship}". Write as if emailing someone they know, not a cold outreach.`
        } else if (ctx.knows_them) {
          relationshipNote = `Relationship: The sender already knows the recipient (no additional context provided). Write as if emailing someone they know, not a cold outreach.`
        } else {
          relationshipNote = `Relationship: The sender does not know the recipient personally. They are connected through the vouch chain shown above.`
        }

        // Add intermediary context if provided (how sender knows their mutual connection)
        if (degree >= 2 && ctx.intermediary_context) {
          const intermediaryName = vouchPath.length >= 2 ? vouchPath[1].name : null
          if (intermediaryName) {
            relationshipNote += `\nHow the sender knows ${intermediaryName}: "${ctx.intermediary_context}". You can mention this naturally to establish credibility (e.g., "${intermediaryName} and I ${ctx.intermediary_context}").`
          }
        }

        let draftSubject, draftBody
        try {
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 512,
              system: `You are drafting a short professional email on behalf of one person to another. They are connected through VouchFour, a vouch-based professional network.

CRITICAL — what the connection path means:
- The "connection path" is a TRUST CHAIN, not an introduction. Nobody in the chain "connected" these people, "mentioned" anyone, or "recommended" reaching out.
- The intermediary people in the chain have NOT been involved in this outreach at all. Do NOT say anyone "connected us", "put us in touch", "mentioned you", or "suggested I reach out."
- For people who don't know each other: you can say something like "I found you through [intermediary]'s network" or "We're connected through [intermediary] on VouchFour" — but NEVER imply the intermediary took any action.
- The sender knows the recipient's background from their VouchFour profile, NOT because anyone told them. Do NOT attribute knowledge of the recipient to the intermediary.

Guidelines:
- Write ONLY the email body. 2-4 sentences max. Be concise and direct.
- If the sender already knows the recipient, write like you're emailing a colleague — skip explaining the vouch connection and get straight to the ask.
- If they don't know each other, briefly note the connection path (one short clause, not a whole sentence) and move to the ask.
- Reference the recipient's background ONLY if it's directly relevant to the question being asked. Don't shoehorn in flattery.
- State the sender's ACTUAL question — do not reinterpret, embellish, or add specifics the sender didn't ask about. If they asked "What was it like to work at X?", say exactly that. Do NOT invent sub-topics like "product strategy" or "team dynamics" that the sender never mentioned.
- End with the ask itself or a simple next step. Keep it literal.
- Tone: professional, direct, human. Like a real email from a busy professional. Not salesy, not overly warm, not corporate.
- Do NOT include a greeting (e.g., "Hi [name]") or sign-off (e.g., "Best regards") — those are added separately.
- Do NOT use filler phrases like "I hope this finds you well" or "I'd love to connect."
- Generate a short, specific subject line (max 60 chars) — not generic.

Format your response exactly as:
SUBJECT: <subject line>
BODY:
<message body>`,
              messages: [{ role: 'user', content: `Sender: ${sender.display_name}, ${sender.current_title || 'Professional'} at ${sender.current_company || 'N/A'}
Sender background: ${senderSummary}

Recipient: ${recipient.display_name}, ${recipient.current_title || 'Professional'} at ${recipient.current_company || 'N/A'}
Recipient background: ${recipientSummary}

Connection path (${degree === 1 ? '1st degree — direct vouch' : degree + 'nd/rd degree'}): ${chainText}
${relationshipNote}

What ${senderFirst} wants to ask:
"${question}"` }],
            }),
          })
          const data = await claudeRes.json()
          const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

          // Parse SUBJECT and BODY
          const subjectMatch = text.match(/SUBJECT:\s*(.+)/i)
          const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i)
          draftSubject = subjectMatch ? subjectMatch[1].trim() : `Quick question from ${senderFirst} via your network`
          draftBody = bodyMatch ? bodyMatch[1].trim() : `I'm reaching out through our VouchFour network (connected via ${chainText}). ${question}`
        } catch (err) {
          console.warn(`[Quick Ask] Claude draft failed for recipient ${recipient.id}:`, err.message)
          draftSubject = `Quick question from ${senderFirst} via your network`
          draftBody = `I'm reaching out through our VouchFour network (connected via ${chainText}). ${question}`
        }

        // Save the draft
        const knowsRecipient = degree === 1 || (ctx.knows_them === true)
        const draftRes = await query(
          `INSERT INTO quick_ask_recipients (ask_id, recipient_id, vouch_path, draft_subject, draft_body, knows_recipient)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [askId, recipient.id, JSON.stringify(vouchPath), draftSubject, draftBody, knowsRecipient]
        )

        drafts.push({
          id: draftRes.rows[0].id,
          recipient_id: recipient.id,
          recipient_name: recipient.display_name,
          recipient_title: [recipient.current_title, recipient.current_company].filter(Boolean).join(' at '),
          recipient_photo_url: recipient.photo_url || null,
          vouch_path: vouchPath,
          draft_subject: draftSubject,
          draft_body: draftBody,
          no_email: !recipient.email,
          degree,
        })
      }

      trackEvent(session.id, 'quick_ask_drafted', { ask_id: askId, recipient_count: drafts.length })

      res.writeHead(200)
      res.end(JSON.stringify({
        ask_id: askId,
        drafts,
        recipients_at_limit: recipientsAtLimit,
        asks_remaining_this_week: maxSends - senderCount - 1,
      }))
    } catch (err) {
      console.error('[/api/quick-ask/draft error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Quick Ask: Edit a draft ──────────────────────────────────────
  if (req.method === 'PUT' && req.url.match(/^\/api\/quick-ask\/draft\/\d+$/)) {
    try {
      const session = await validateSession(req)
      if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      const draftId = Number(req.url.split('/').pop())
      const body = await readBody(req)

      // Verify ownership
      const check = await query(
        `SELECT qar.id, qar.status FROM quick_ask_recipients qar
         JOIN quick_asks qa ON qa.id = qar.ask_id
         WHERE qar.id = $1 AND qa.sender_id = $2`, [draftId, session.id])
      if (!check.rows[0]) { res.writeHead(404); res.end(JSON.stringify({ error: 'Draft not found' })); return }
      if (check.rows[0].status !== 'draft') { res.writeHead(400); res.end(JSON.stringify({ error: 'Cannot edit a sent message' })); return }

      await query(
        'UPDATE quick_ask_recipients SET draft_subject = COALESCE($2, draft_subject), draft_body = COALESCE($3, draft_body) WHERE id = $1',
        [draftId, body.draft_subject || null, body.draft_body || null]
      )

      res.writeHead(200)
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      console.error('[/api/quick-ask/draft/:id error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Quick Ask: Send drafted messages ─────────────────────────────
  if (req.method === 'POST' && req.url === '/api/quick-ask/send') {
    try {
      const session = await validateSession(req)
      if (!session) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
      const body = await readBody(req)
      const { ask_id, recipient_row_ids } = body

      if (!ask_id) { res.writeHead(400); res.end(JSON.stringify({ error: 'ask_id required' })); return }

      // Load drafts for this ask, verify ownership
      let draftsQuery = `
        SELECT qar.*, qa.sender_id, qa.question,
               p.display_name AS recipient_name, p.email AS recipient_email
        FROM quick_ask_recipients qar
        JOIN quick_asks qa ON qa.id = qar.ask_id
        JOIN people p ON p.id = qar.recipient_id
        WHERE qar.ask_id = $1 AND qa.sender_id = $2 AND qar.status = 'draft'`
      const params = [ask_id, session.id]
      if (Array.isArray(recipient_row_ids) && recipient_row_ids.length > 0) {
        draftsQuery += ` AND qar.id = ANY($3)`
        params.push(recipient_row_ids)
      }
      const draftsRes = await query(draftsQuery, params)

      if (draftsRes.rows.length === 0) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'No drafts found to send' })); return
      }

      // Re-check sender rate limit
      const maxSends = await getQuickAskLimit('quick_ask_max_sends_per_week')
      const senderCount = await countSenderAsksThisWeek(session.id)
      if (senderCount >= maxSends) {
        res.writeHead(429); res.end(JSON.stringify({ error: 'Weekly send limit reached' })); return
      }

      // Load sender info for template
      const senderRes = await query('SELECT display_name, email FROM people WHERE id = $1', [session.id])
      const sender = senderRes.rows[0]
      const senderParts = sender.display_name.split(' ')
      const senderFirst = senderParts[0]
      const senderLast = senderParts.slice(1).join(' ')

      const results = []

      for (const draft of draftsRes.rows) {
        const result = { id: draft.id, recipient_id: draft.recipient_id, status: 'failed', reason: null }

        try {
          // Check recipient rate limit
          const maxReceives = await getQuickAskLimit('quick_ask_max_receives_per_week')
          const recvCount = await countRecipientReceivesThisWeek(draft.recipient_id)
          if (recvCount >= maxReceives) {
            result.reason = 'Recipient has reached their receive limit this week'
            results.push(result); continue
          }

          // Check unsubscribed
          if (await isUnsubscribed(draft.recipient_id)) {
            result.reason = 'Recipient has unsubscribed from emails'
            await query("UPDATE quick_ask_recipients SET status = 'failed' WHERE id = $1", [draft.id])
            results.push(result); continue
          }

          // Check daily email cap
          if (!(await canEmailRecipient(draft.recipient_id))) {
            result.reason = 'Recipient daily email limit reached, try tomorrow'
            results.push(result); continue
          }

          // Check recipient has email
          if (!draft.recipient_email) {
            result.reason = 'No email address on file for this person'
            await query("UPDATE quick_ask_recipients SET status = 'failed' WHERE id = $1", [draft.id])
            results.push(result); continue
          }

          // Build connection section — suppress for 1st degree or when sender knows recipient
          const vouchPath = draft.vouch_path || []
          const degree = vouchPath.length - 1
          let connectionSection = ''
          if (!draft.knows_recipient && degree >= 2) {
            const chainParts = vouchPath.map((p, i) => {
              const bold = `<strong style="color:#1C1917;">${p.name}</strong>`
              if (i === 0) return bold
              return `<span style="color:#4F46E5;font-size:13px;"> → </span>${bold}`
            })
            const vouchChainHtml = `<div style="font-size:14px;color:#44403C;line-height:1.8;">${chainParts.join('')}</div>`
            connectionSection = `<div style="margin:16px 0;padding:16px 20px;background:#F8F7F6;border-radius:12px;border-left:4px solid #4F46E5;">
  <div style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">How you're connected</div>
  ${vouchChainHtml}
</div>`
          }

          // Convert draft body newlines to HTML
          const messageBody = draft.draft_body.replace(/\n/g, '<br/>')

          // Load and populate email template
          const template = await loadTemplate('quick_ask')
          const recipientFirst = draft.recipient_name.split(' ')[0]
          const vars = {
            senderName: sender.display_name,
            senderFirstName: senderFirst,
            senderLastName: senderLast,
            recipientFirstName: recipientFirst,
            recipientName: draft.recipient_name,
            connectionSection,
            messageBody,
            replyUrl: await (async () => {
              // Generate a login token so recipient can authenticate via the CTA link
              const replyLoginToken = crypto.randomUUID()
              await query(
                `INSERT INTO login_tokens (token, person_id, expires_at)
                 VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
                [replyLoginToken, draft.recipient_id]
              )
              return `${BASE_URL}/person/${session.id}?token=${replyLoginToken}&reply_to=${draft.id}`
            })(),
          }
          const rawSubject = applyVariables(draft.draft_subject || template.subject, vars)
          const subject = `From ${sender.display_name}: ${rawSubject}`
          const bodyHtml = applyVariables(template.body_html, vars)
          const html = emailLayout(bodyHtml, draft.recipient_id)

          // Send via Resend
          const recipientEmail = await getRecipient(draft.recipient_email)
          const emailResult = await sendEmail({
            to: recipientEmail,
            subject,
            html,
            personId: draft.recipient_id,
            templateKey: 'quick_ask',
          })

          // Record in sent_emails
          await query(
            `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
             VALUES ($1, 'quick_ask', $2, $3)`,
            [draft.recipient_id, ask_id, emailResult?.id || null]
          )

          // Update draft status
          await query(
            "UPDATE quick_ask_recipients SET status = 'sent', sent_at = NOW() WHERE id = $1",
            [draft.id]
          )

          result.status = 'sent'
          trackEvent(session.id, 'quick_ask_sent', {
            ask_id, recipient_id: draft.recipient_id,
            degree: (draft.vouch_path || []).length - 1,
          })
        } catch (sendErr) {
          console.error(`[Quick Ask] Send failed for draft ${draft.id}:`, sendErr.message)
          result.reason = 'Email delivery failed'
          await query("UPDATE quick_ask_recipients SET status = 'failed' WHERE id = $1", [draft.id])
        }

        results.push(result)
      }

      res.writeHead(200)
      res.end(JSON.stringify({ results }))
    } catch (err) {
      console.error('[/api/quick-ask/send error]', err)
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

  // ─── Create session from vouch invite token ──────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/auth/vouch-session')) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`)
      const vouchToken = urlObj.searchParams.get('token')

      if (!vouchToken) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'token is required' }))
        return
      }

      // Look up vouch invite
      const inviteRes = await query(`
        SELECT vi.id, vi.status, vi.invitee_id, vi.inviter_id, vi.job_function_id,
               p.display_name, p.linkedin_url, p.email,
               inviter.display_name AS inviter_name,
               jf.id AS jf_id, jf.name AS jf_name, jf.slug AS jf_slug, jf.practitioner_label AS jf_practitioner_label
        FROM vouch_invites vi
        JOIN people p ON p.id = vi.invitee_id
        JOIN people inviter ON inviter.id = vi.inviter_id
        LEFT JOIN job_functions jf ON jf.id = vi.job_function_id
        WHERE vi.token = $1
      `, [vouchToken])

      if (inviteRes.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Invalid invite token' }))
        return
      }

      const invite = inviteRes.rows[0]
      const isSelfInvite = invite.inviter_id === invite.invitee_id
      const person = {
        id: invite.invitee_id,
        display_name: invite.display_name,
        linkedin_url: invite.linkedin_url,
        email: invite.email,
      }

      // Check if already completed or has existing vouches in this function
      const existingVouches = await query(
        'SELECT 1 FROM vouches WHERE voucher_id = $1 AND job_function_id = $2 LIMIT 1',
        [person.id, invite.job_function_id]
      )
      const isUpdate = invite.status === 'completed' || existingVouches.rows.length > 0

      // Check if user already has a valid session
      const existingSession = await validateSession(req)
      if (!existingSession || existingSession.id !== person.id) {
        // Create new session
        const sessionToken = crypto.randomUUID()
        await query(
          `INSERT INTO sessions (token, person_id, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
          [sessionToken, person.id]
        )
        res.setHeader('Set-Cookie',
          `vf_session=${sessionToken}; HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`
        )
        identifyPerson(String(person.id), { name: person.display_name })
        trackEvent(String(person.id), 'vouch_session_created', { person_id: person.id, invite_token: vouchToken })
      }

      const vouchCheck = await query('SELECT EXISTS(SELECT 1 FROM vouches WHERE voucher_id = $1) AS has_vouched', [person.id])

      res.writeHead(200)
      res.end(JSON.stringify({
        user: {
          id: person.id,
          name: person.display_name,
          linkedin: person.linkedin_url,
          email: person.email,
          has_vouched: vouchCheck.rows[0].has_vouched,
        },
        inviterName: isSelfInvite ? null : invite.inviter_name,
        jobFunction: invite.jf_id ? { id: invite.jf_id, name: invite.jf_name, slug: invite.jf_slug, practitionerLabel: invite.jf_practitioner_label } : null,
        vouchToken,
        isUpdate,
      }))
    } catch (err) {
      console.error('[/api/auth/vouch-session error]', err)
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
        'SELECT id, display_name, linkedin_url, email, current_title, current_company, photo_url FROM people WHERE id = $1',
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

      const vouchCheck = await query('SELECT EXISTS(SELECT 1 FROM vouches WHERE voucher_id = $1) AS has_vouched', [person.id])

      res.writeHead(200)
      res.end(JSON.stringify({
        user: {
          id: person.id,
          name: person.display_name,
          linkedin: person.linkedin_url,
          email: person.email,
          has_vouched: vouchCheck.rows[0].has_vouched,
          current_title: person.current_title || null,
          current_company: person.current_company || null,
          photo_url: person.photo_url || null,
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

      const vouchCheck = await query('SELECT EXISTS(SELECT 1 FROM vouches WHERE voucher_id = $1) AS has_vouched', [person.id])

      res.writeHead(200)
      res.end(JSON.stringify({
        user: {
          id: person.id,
          name: person.display_name,
          linkedin: person.linkedin_url,
          email: person.email,
          has_vouched: vouchCheck.rows[0].has_vouched,
          current_title: person.current_title || null,
          current_company: person.current_company || null,
          photo_url: person.photo_url || null,
        },
      }))
    } catch (err) {
      console.error('[/api/auth/session error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Network preview for pre-vouch homepage ─────────────────────
  if (req.method === 'GET' && req.url === '/api/my-network-preview') {
    try {
      const person = await validateSession(req)
      if (!person) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'No valid session' }))
        return
      }

      // Who vouched for this user (sponsors)
      const sponsorsRes = await query(`
        SELECT DISTINCT p.id, p.display_name, p.current_title, p.current_company, p.photo_url
        FROM vouches v JOIN people p ON p.id = v.voucher_id
        WHERE v.vouchee_id = $1
      `, [person.id])

      // Full network via existing graph traversal
      const recommendations = await getTalentRecommendations(person.id, null)
      const highlighted = recommendations.slice(0, 8).map(r => ({
        id: r.id,
        name: r.display_name,
        title: r.current_title,
        company: r.current_company,
        photoUrl: r.photo_url,
        degree: r.degree,
      }))

      res.writeHead(200)
      res.end(JSON.stringify({
        sponsors: sponsorsRes.rows.map(s => ({
          name: s.display_name,
          title: s.current_title,
          company: s.current_company,
          photoUrl: s.photo_url,
        })),
        networkSize: recommendations.length,
        highlighted,
      }))
    } catch (err) {
      console.error('[/api/my-network-preview error]', err)
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
