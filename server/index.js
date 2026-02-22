import './lib/env.js'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, getClient } from './lib/db.js'
import { normalizeLinkedInUrl } from './lib/linkedin.js'
import { getTalentRecommendations } from './lib/graph.js'
import { sendPleaseVouchEmail, sendYouWereVouchedEmail, sendLoginLinkEmail, sendRoleNetworkEmail } from './lib/email.js'
import { checkAndNotifyReadiness, checkRoleReadiness } from './lib/readiness.js'

const PORT = process.env.PORT || 3001

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ─── IP rate limiting (in-memory) ──────────────────────────────────
const ipRequestCounts = new Map() // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_MAX = 10 // max email-triggering requests per window per IP

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
const ADMIN_SECRET = process.env.ADMIN_SECRET || ''

function generateRoleSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'r_'
  for (let i = 0; i < 5; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

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

const server = http.createServer(async (req, res) => {
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

      // Extract company from detail (e.g. "CEO · Anuvi" → "Anuvi")
      let company = ''
      if (detail) {
        const m = detail.match(/[·•]\s*(.+)$/) || detail.match(/at\s+(.+)$/i) || detail.match(/[-–]\s*(.+)$/)
        company = m ? m[1].trim() : ''
      }

      // ── Step 1: Brave Search (fast, ~500ms) ──────────────────────────
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
        res.writeHead(200)
        res.end(JSON.stringify({ emails: braveEmails, source: 'brave' }))
        return
      }

      // ── Step 2: Claude fallback (slower, ~5-15s) ─────────────────────
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
      res.writeHead(200)
      res.end(JSON.stringify({ emails: parsed.emails || [], source: 'claude' }))
    } catch (err) {
      console.error('[/api/find-email error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error', emails: [] }))
    }
    return
  }

  // ─── Submit Network form ────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/submit-network') {
    if (isRateLimited(req)) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }
    const client = await getClient()
    try {
      const body = await readBody(req)
      const { user, connectors } = body

      if (!user?.linkedin || !user?.name) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'user.name and user.linkedin are required' }))
        client.release()
        return
      }

      const submitterUrl = normalizeLinkedInUrl(user.linkedin)
      if (!submitterUrl) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Invalid LinkedIn URL for user' }))
        client.release()
        return
      }

      await client.query('BEGIN')

      // Upsert submitter — self-provided, always update & lock
      const submitterRes = await client.query(`
        INSERT INTO people (linkedin_url, display_name, email, self_provided)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (linkedin_url) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            email = EXCLUDED.email,
            self_provided = TRUE,
            updated_at = NOW()
        RETURNING id
      `, [submitterUrl, user.name, user.email || null])
      const submitterId = submitterRes.rows[0].id

      // Snapshot existing connectors BEFORE processing new ones
      // so we can diff for email sending
      const existingConnectorsRes = await client.query(`
        SELECT p.id, p.linkedin_url, p.email
        FROM edges e
        JOIN people p ON p.id = e.target_id
        WHERE e.source_id = $1 AND e.edge_type = 'network'
      `, [submitterId])
      const existingByUrl = new Map()
      for (const row of existingConnectorsRes.rows) {
        existingByUrl.set(row.linkedin_url, { id: row.id, email: row.email })
      }

      // Create submission record
      const subRes = await client.query(`
        INSERT INTO submissions (submitter_id, form_type, submitted_at, raw_payload)
        VALUES ($1, 'network', NOW(), $2)
        RETURNING id
      `, [submitterId, JSON.stringify(body)])
      const submissionId = subRes.rows[0].id

      const inviteTokens = []

      // Process each connector
      for (const c of (connectors || [])) {
        if (!c?.linkedin || !c?.name) continue
        const connectorUrl = normalizeLinkedInUrl(c.linkedin)
        if (!connectorUrl) continue

        // Check if this connector existed before with the same email
        const existing = existingByUrl.get(connectorUrl)
        const isNew = !existing
        const emailChanged = existing && c.email && c.email !== existing.email

        // Upsert connector — only update if not self-provided
        const connectorRes = await client.query(`
          INSERT INTO people (linkedin_url, display_name, email)
          VALUES ($1, $2, $3)
          ON CONFLICT (linkedin_url) DO UPDATE
          SET display_name = CASE WHEN people.self_provided THEN people.display_name
                                  ELSE COALESCE(NULLIF(EXCLUDED.display_name, ''), people.display_name) END,
              email = CASE WHEN people.self_provided THEN people.email
                           ELSE COALESCE(EXCLUDED.email, people.email) END,
              updated_at = NOW()
          RETURNING id
        `, [connectorUrl, c.name, c.email || null])
        const connectorId = connectorRes.rows[0].id

        // Upsert network edge
        await client.query(`
          INSERT INTO edges (source_id, target_id, edge_type, submission_id)
          VALUES ($1, $2, 'network', $3)
          ON CONFLICT (source_id, target_id, edge_type)
          DO UPDATE SET submission_id = EXCLUDED.submission_id, created_at = NOW()
        `, [submitterId, connectorId, submissionId])

        // Check if this person has ever completed a vouch (for any inviter).
        // If so, their recommendations are already in the graph — no invite needed.
        const hasVouched = await client.query(
          `SELECT 1 FROM vouch_invites WHERE invitee_id = $1 AND status = 'completed' LIMIT 1`,
          [connectorId]
        )
        if (hasVouched.rows.length > 0) {
          console.log(`[Network] ${c.name} has already vouched — skipping invite`)
          continue
        }

        // Check if a pending invite already exists for this inviter→invitee pair
        let token, inviteId
        const existingInvite = await client.query(`
          SELECT id, token FROM vouch_invites
          WHERE inviter_id = $1 AND invitee_id = $2 AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1
        `, [submitterId, connectorId])
        if (existingInvite.rows.length > 0) {
          token = existingInvite.rows[0].token
          inviteId = existingInvite.rows[0].id
        } else {
          token = crypto.randomUUID()
          const inviteRes2 = await client.query(`
            INSERT INTO vouch_invites (token, inviter_id, invitee_id)
            VALUES ($1, $2, $3)
            RETURNING id
          `, [token, submitterId, connectorId])
          inviteId = inviteRes2.rows[0].id
        }

        inviteTokens.push({
          name: c.name, email: c.email, token,
          personId: connectorId, inviteId,
          shouldEmail: isNew || emailChanged,
        })
      }

      // Remove edges and cancel pending invites for connectors that were removed
      const currentConnectorUrls = (connectors || [])
        .map(c => c?.linkedin ? normalizeLinkedInUrl(c.linkedin) : null)
        .filter(Boolean)
      for (const [url, existing] of existingByUrl) {
        if (!currentConnectorUrls.includes(url)) {
          // Remove network edge
          await client.query(
            `DELETE FROM edges WHERE source_id = $1 AND target_id = $2 AND edge_type = 'network'`,
            [submitterId, existing.id]
          )
          // Delete any pending invites from this submitter to the removed connector
          await client.query(
            `DELETE FROM vouch_invites
             WHERE inviter_id = $1 AND invitee_id = $2 AND status = 'pending'`,
            [submitterId, existing.id]
          )
          console.log(`[Network] Removed connector ${url} from ${user.name}'s network`)
        }
      }

      // Check if the talent page is ready (talent_ready email was previously sent)
      const readyRes = await client.query(
        `SELECT 1 FROM sent_emails WHERE recipient_id = $1 AND email_type = 'talent_ready' LIMIT 1`,
        [submitterId]
      )
      const talentReady = readyRes.rows.length > 0

      await client.query('COMMIT')

      const slug = submitterUrl.split('/in/')[1]
      const newCount = inviteTokens.filter(i => i.shouldEmail).length
      console.log(`[Network] Submitted for ${user.name}: ${inviteTokens.length} connectors (${newCount} new/changed, will email)`)

      // Send vouch invite emails only to new or email-changed connectors (fire-and-forget, sequential to avoid rate limits)
      const inviterFirstName = user.name.split(' ')[0]
      ;(async () => {
        for (const invite of inviteTokens) {
          if (!invite.email || !invite.shouldEmail) continue
          try {
            if (!(await canEmailRecipient(invite.personId))) {
              console.log(`[Email] Daily cap reached for ${invite.name}, skipping please_vouch`)
              continue
            }
            const resendId = await sendPleaseVouchEmail(
              { display_name: invite.name, email: invite.email },
              inviterFirstName,
              invite.token
            )
            await query(
              `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
               VALUES ($1, 'please_vouch', $2, $3)`,
              [invite.personId, invite.inviteId, resendId]
            )
          } catch (err) {
            console.error(`[Email] Failed to send please_vouch to ${invite.name}:`, err.message)
          }
          await sleep(600)
        }
      })()

      res.writeHead(200)
      res.end(JSON.stringify({
        talentUrl: `/talent/${slug}`,
        talentReady,
        inviteTokens,
      }))
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[/api/submit-network error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    } finally {
      client.release()
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
        SELECT vi.id, vi.status, vi.invitee_id, p.display_name, p.linkedin_url, p.email
        FROM vouch_invites vi
        JOIN people p ON p.id = vi.invitee_id
        WHERE vi.token = $1
      `, [token])

      if (result.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Invalid or expired invite token' }))
        return
      }

      const invite = result.rows[0]

      // For completed invites, return existing vouches so the form can pre-populate
      if (invite.status === 'completed') {
        const vouchesRes = await query(`
          SELECT p.display_name AS name, p.linkedin_url AS linkedin, p.email
          FROM edges e
          JOIN people p ON p.id = e.target_id
          WHERE e.source_id = $1 AND e.edge_type = 'vouch'
          ORDER BY e.created_at
        `, [invite.invitee_id])

        res.writeHead(200)
        res.end(JSON.stringify({
          name: invite.display_name,
          linkedin: invite.linkedin_url,
          email: invite.email,
          isUpdate: true,
          existingVouches: vouchesRes.rows,
        }))
        return
      }

      // Check if this person has vouched before (via a different invite)
      const hasVouched = await query(
        `SELECT 1 FROM vouch_invites WHERE invitee_id = $1 AND status = 'completed' LIMIT 1`,
        [invite.invitee_id]
      )
      if (hasVouched.rows.length > 0) {
        // They've vouched before — load their existing vouches for pre-population
        const vouchesRes = await query(`
          SELECT p.display_name AS name, p.linkedin_url AS linkedin, p.email
          FROM edges e
          JOIN people p ON p.id = e.target_id
          WHERE e.source_id = $1 AND e.edge_type = 'vouch'
          ORDER BY e.created_at
        `, [invite.invitee_id])

        res.writeHead(200)
        res.end(JSON.stringify({
          name: invite.display_name,
          linkedin: invite.linkedin_url,
          email: invite.email,
          isUpdate: true,
          existingVouches: vouchesRes.rows,
        }))
        return
      }

      res.writeHead(200)
      res.end(JSON.stringify({
        name: invite.display_name,
        linkedin: invite.linkedin_url,
        email: invite.email,
      }))
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
        SELECT vi.id, vi.inviter_id, vi.invitee_id, vi.status, p.display_name
        FROM vouch_invites vi
        JOIN people p ON p.id = vi.invitee_id
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

      await client.query('BEGIN')

      // Snapshot existing vouches BEFORE processing (for email diffing)
      const existingVouchesRes = await client.query(`
        SELECT p.id, p.linkedin_url, p.email
        FROM edges e
        JOIN people p ON p.id = e.target_id
        WHERE e.source_id = $1 AND e.edge_type = 'vouch'
      `, [voucherId])
      const existingByUrl = new Map()
      for (const row of existingVouchesRes.rows) {
        existingByUrl.set(row.linkedin_url, { id: row.id, email: row.email })
      }

      // Create submission record
      const subRes = await client.query(`
        INSERT INTO submissions (submitter_id, form_type, submitted_at, raw_payload)
        VALUES ($1, 'vouch', NOW(), $2)
        RETURNING id
      `, [voucherId, JSON.stringify(body)])
      const submissionId = subRes.rows[0].id

      // Process each recommendation
      const vouchedPeople = []

      for (const r of (recommendations || [])) {
        if (!r?.linkedin || !r?.name) continue
        const talentUrl = normalizeLinkedInUrl(r.linkedin)
        if (!talentUrl) continue

        // Check if this person existed before with the same email
        const existing = existingByUrl.get(talentUrl)
        const isNew = !existing
        const emailChanged = existing && r.email && r.email !== existing.email

        // Upsert talent person — only update if not self-provided
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

        // Upsert vouch edge
        await client.query(`
          INSERT INTO edges (source_id, target_id, edge_type, submission_id)
          VALUES ($1, $2, 'vouch', $3)
          ON CONFLICT (source_id, target_id, edge_type)
          DO UPDATE SET submission_id = EXCLUDED.submission_id, created_at = NOW()
        `, [voucherId, talentId, submissionId])

        vouchedPeople.push({
          id: talentId, display_name: r.name,
          email: r.email || null, linkedin_url: talentUrl,
          shouldEmail: isNew || emailChanged,
        })
      }

      // Mark invite as completed (idempotent for updates)
      await client.query(`
        UPDATE vouch_invites SET status = 'completed', submission_id = $1
        WHERE id = $2
      `, [submissionId, invite.id])

      // Remove vouch edges for people that were removed from the list
      const currentVouchUrls = (recommendations || [])
        .map(r => r?.linkedin ? normalizeLinkedInUrl(r.linkedin) : null)
        .filter(Boolean)
      for (const [url, existing] of existingByUrl) {
        if (!currentVouchUrls.includes(url)) {
          await client.query(
            `DELETE FROM edges WHERE source_id = $1 AND target_id = $2 AND edge_type = 'vouch'`,
            [voucherId, existing.id]
          )
          console.log(`[Vouch] Removed vouch for ${url} from ${invite.display_name}'s recommendations`)
        }
      }

      // For updates: create a new pending invite so they can update again later
      if (isUpdate) {
        const newToken = crypto.randomUUID()
        await client.query(
          `INSERT INTO vouch_invites (token, inviter_id, invitee_id) VALUES ($1, $2, $3)`,
          [newToken, invite.inviter_id, voucherId]
        )
      }

      await client.query('COMMIT')

      const newCount = vouchedPeople.filter(v => v.shouldEmail).length
      console.log(`[Vouch] ${invite.display_name} ${isUpdate ? 'updated' : 'submitted'} vouches for ${vouchedPeople.length} people (${newCount} new/changed, will email)`)

      // Check if the voucher has a talent page ready (for redirect)
      let talentReady = false
      let talentUrl = null
      const personRes = await query(
        `SELECT linkedin_url FROM people WHERE id = $1`, [voucherId]
      )
      if (personRes.rows[0]?.linkedin_url) {
        const slug = personRes.rows[0].linkedin_url.split('/in/')[1]
        const readyRes = await query(
          `SELECT 1 FROM sent_emails WHERE recipient_id = $1 AND email_type = 'talent_ready' LIMIT 1`,
          [voucherId]
        )
        if (readyRes.rows.length > 0) {
          talentReady = true
          talentUrl = `/talent/${slug}`
        }
      }

      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, talentReady, talentUrl }))

      // ── Post-commit async tasks (fire-and-forget) ──

      // Check if inviter's talent network is ready
      checkAndNotifyReadiness(invite.inviter_id).catch(err =>
        console.error('[Readiness] Post-vouch check failed:', err.message)
      )

      // Send "you were vouched" emails only to new or email-changed talent people (sequential to avoid rate limits)
      ;(async () => {
        for (const talent of vouchedPeople) {
          if (!talent.email || !talent.shouldEmail) continue
          try {
            // Check if already sent (unique index also prevents, but skip the attempt)
            const already = await query(
              `SELECT 1 FROM sent_emails WHERE recipient_id = $1 AND email_type = 'you_were_vouched' LIMIT 1`,
              [talent.id]
            )
            if (already.rows.length > 0) continue

            if (!(await canEmailRecipient(talent.id))) {
              console.log(`[Email] Daily cap reached for ${talent.display_name}, skipping you_were_vouched`)
              continue
            }

            // Create a vouch invite for this talent person so they can vouch for others
            const newToken = crypto.randomUUID()
            await query(
              `INSERT INTO vouch_invites (token, inviter_id, invitee_id) VALUES ($1, $2, $3)`,
              [newToken, voucherId, talent.id]
            )

            const resendId = await sendYouWereVouchedEmail(talent, newToken, invite.display_name)
            await query(
              `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
               VALUES ($1, 'you_were_vouched', $2, $3)
               ON CONFLICT DO NOTHING`,
              [talent.id, invite.id, resendId]
            )
          } catch (err) {
            console.error(`[Email] Failed to send you_were_vouched to ${talent.display_name}:`, err.message)
          }
          await sleep(600)
        }
      })()
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
      const slug = req.url.split('/api/talent/')[1]
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

      const linkedinUrl = `https://linkedin.com/in/${slug.toLowerCase()}`

      // Verify session user matches the slug
      if (session.linkedin_url !== linkedinUrl) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      const userId = session.id
      const talent = await getTalentRecommendations(userId)

      // Get network status (connector response rates, deduplicated per person)
      const networkRes = await query(`
        SELECT DISTINCT ON (p.id)
          p.id,
          p.display_name AS name,
          vi.status,
          vi.created_at
        FROM vouch_invites vi
        JOIN people p ON p.id = vi.invitee_id
        WHERE vi.inviter_id = $1 AND vi.invitee_id != $1
        ORDER BY p.id, CASE WHEN vi.status = 'completed' THEN 0 ELSE 1 END, vi.created_at DESC
      `, [userId])

      const connectors = networkRes.rows
      const networkStatus = {
        total: connectors.length,
        completed: connectors.filter(c => c.status === 'completed').length,
        connectors: connectors.map(c => ({ id: c.id, name: c.name, status: c.status })),
      }

      // Get the user's own vouches (people they recommended)
      const vouchesRes = await query(`
        SELECT p.display_name AS name, p.linkedin_url AS linkedin
        FROM edges e
        JOIN people p ON p.id = e.target_id
        WHERE e.source_id = $1 AND e.edge_type = 'vouch'
        ORDER BY e.created_at
      `, [userId])

      // Find or create a pending vouch invite so the user can update their vouches
      let vouchToken = null
      if (vouchesRes.rows.length > 0) {
        // Look for an existing pending invite where this user is the invitee
        const pendingRes = await query(
          `SELECT token FROM vouch_invites WHERE invitee_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
          [userId]
        )
        if (pendingRes.rows.length > 0) {
          vouchToken = pendingRes.rows[0].token
        } else {
          // Create a self-referencing invite so they can re-vouch
          vouchToken = crypto.randomUUID()
          await query(
            `INSERT INTO vouch_invites (token, inviter_id, invitee_id) VALUES ($1, $2, $3)`,
            [vouchToken, userId, userId]
          )
        }
      }

      res.writeHead(200)
      res.end(JSON.stringify({
        user: { name: session.display_name, linkedin: linkedinUrl },
        talent,
        networkStatus,
        myVouches: vouchesRes.rows,
        vouchToken,
      }))
    } catch (err) {
      console.error('[/api/talent error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error', talent: [] }))
    }
    return
  }

  // ─── Get network data for editing (auth required) ──────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/network/')) {
    try {
      const slug = req.url.split('/api/network/')[1]
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

      const linkedinUrl = `https://linkedin.com/in/${slug.toLowerCase()}`

      // Verify session user matches the slug
      if (session.linkedin_url !== linkedinUrl) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      // Get the user's connectors (people they listed in their network)
      const connectorsRes = await query(`
        SELECT p.display_name AS name, p.linkedin_url AS linkedin, p.email
        FROM edges e
        JOIN people p ON p.id = e.target_id
        WHERE e.source_id = $1 AND e.edge_type = 'network'
        ORDER BY e.created_at
      `, [session.id])

      res.writeHead(200)
      res.end(JSON.stringify({
        user: {
          name: session.display_name,
          linkedin: session.linkedin_url,
          email: session.email,
        },
        connectors: connectorsRes.rows,
      }))
    } catch (err) {
      console.error('[/api/network error]', err)
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

  // ─── Create role-specific talent search (auth required) ─────────
  if (req.method === 'POST' && req.url === '/api/create-role') {
    if (isRateLimited(req)) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }
    const client = await getClient()
    try {
      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        client.release()
        return
      }

      const body = await readBody(req)
      const { jobFunction, level, specialSkills, recommenderIds } = body

      if (!jobFunction?.trim() || !level?.trim()) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'jobFunction and level are required' }))
        client.release()
        return
      }

      if (!Array.isArray(recommenderIds) || recommenderIds.length === 0) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'At least one recommender is required' }))
        client.release()
        return
      }

      await client.query('BEGIN')

      // Generate unique role slug
      let roleSlug
      for (let i = 0; i < 10; i++) {
        roleSlug = generateRoleSlug()
        const exists = await client.query('SELECT 1 FROM roles WHERE slug = $1', [roleSlug])
        if (exists.rows.length === 0) break
      }

      // Create role
      const roleRes = await client.query(`
        INSERT INTO roles (slug, creator_id, job_function, level, special_skills)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, slug
      `, [roleSlug, session.id, jobFunction.trim(), level.trim(), specialSkills?.trim() || null])
      const roleId = roleRes.rows[0].id

      // Create submission record
      await client.query(`
        INSERT INTO submissions (submitter_id, form_type, submitted_at, raw_payload)
        VALUES ($1, 'role_vouch', NOW(), $2)
        RETURNING id
      `, [session.id, JSON.stringify(body)])

      // Create role_invites for each selected recommender
      const invites = []
      for (const recommId of recommenderIds) {
        const token = crypto.randomUUID()
        await client.query(`
          INSERT INTO role_invites (token, role_id, inviter_id, invitee_id)
          VALUES ($1, $2, $3, $4)
        `, [token, roleId, session.id, recommId])

        const recommRes = await client.query(
          'SELECT id, display_name, email FROM people WHERE id = $1',
          [recommId]
        )
        if (recommRes.rows[0]) {
          invites.push({ ...recommRes.rows[0], token })
        }
      }

      await client.query('COMMIT')

      console.log(`[Role] Created role ${roleSlug} for ${session.display_name}: ${jobFunction} (${level}), ${invites.length} recommenders`)

      // Fire-and-forget: send role_network emails sequentially to avoid rate limits
      const role = { slug: roleSlug, job_function: jobFunction.trim(), level: level.trim(), special_skills: specialSkills?.trim() || null }
      const inviterFirstName = session.display_name.split(' ')[0]
      ;(async () => {
        for (const invite of invites) {
          if (!invite.email) continue
          try {
            if (!(await canEmailRecipient(invite.id))) {
              console.log(`[Email] Daily cap reached for ${invite.display_name}, skipping role_network`)
              continue
            }
            const resendId = await sendRoleNetworkEmail(invite, inviterFirstName, role, invite.token)
            await query(
              `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
               VALUES ($1, 'role_network', $2, $3)`,
              [invite.id, roleId, resendId]
            )
          } catch (err) {
            console.error(`[Email] Failed to send role_network to ${invite.display_name}:`, err.message)
          }
          await sleep(600)
        }
      })()

      res.writeHead(200)
      res.end(JSON.stringify({ roleSlug, ok: true }))
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[/api/create-role error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    } finally {
      client.release()
    }
    return
  }

  // ─── Validate role invite token ────────────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/role-invite/')) {
    try {
      const token = req.url.split('/api/role-invite/')[1]
      if (!token) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Token is required' }))
        return
      }

      const result = await query(`
        SELECT ri.id, ri.status, ri.invitee_id, ri.role_id,
               p.display_name, p.linkedin_url, p.email,
               r.slug AS role_slug, r.job_function, r.level, r.special_skills,
               creator.display_name AS creator_name
        FROM role_invites ri
        JOIN people p ON p.id = ri.invitee_id
        JOIN roles r ON r.id = ri.role_id
        JOIN people creator ON creator.id = r.creator_id
        WHERE ri.token = $1
      `, [token])

      if (result.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Invalid or expired invite token' }))
        return
      }

      const invite = result.rows[0]

      // For completed invites, return existing role vouches for pre-population
      if (invite.status === 'completed') {
        const vouchesRes = await query(`
          SELECT p.display_name AS name, p.linkedin_url AS linkedin, p.email
          FROM role_people rp
          JOIN people p ON p.id = rp.person_id
          WHERE rp.role_id = $1 AND rp.recommender_id = $2
          ORDER BY rp.created_at
        `, [invite.role_id, invite.invitee_id])

        res.writeHead(200)
        res.end(JSON.stringify({
          name: invite.display_name,
          linkedin: invite.linkedin_url,
          email: invite.email,
          role: {
            slug: invite.role_slug,
            jobFunction: invite.job_function,
            level: invite.level,
            specialSkills: invite.special_skills,
            creatorName: invite.creator_name,
          },
          isUpdate: true,
          existingVouches: vouchesRes.rows,
        }))
        return
      }

      res.writeHead(200)
      res.end(JSON.stringify({
        name: invite.display_name,
        linkedin: invite.linkedin_url,
        email: invite.email,
        role: {
          slug: invite.role_slug,
          jobFunction: invite.job_function,
          level: invite.level,
          specialSkills: invite.special_skills,
          creatorName: invite.creator_name,
        },
      }))
    } catch (err) {
      console.error('[/api/role-invite error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Get role detail (auth required, creator only) ─────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/role/')) {
    try {
      const roleSlug = req.url.split('/api/role/')[1]
      if (!roleSlug) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Role slug is required' }))
        return
      }

      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }

      const roleRes = await query(
        `SELECT id, slug, creator_id, job_function, level, special_skills, status, created_at
         FROM roles WHERE slug = $1`,
        [roleSlug]
      )
      if (roleRes.rows.length === 0) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'Role not found' }))
        return
      }
      const role = roleRes.rows[0]

      if (role.creator_id !== session.id) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      // Get role talent (1st degree only, from role_people)
      const talentRes = await query(`
        SELECT p.id, p.display_name, p.linkedin_url, p.email,
               rp.recommender_id
        FROM role_people rp
        JOIN people p ON p.id = rp.person_id
        WHERE rp.role_id = $1
        ORDER BY p.display_name
      `, [role.id])

      // Aggregate: group by person, count recommendations
      const talentMap = new Map()
      for (const row of talentRes.rows) {
        if (!talentMap.has(row.id)) {
          talentMap.set(row.id, {
            id: row.id,
            display_name: row.display_name,
            linkedin_url: row.linkedin_url,
            email: row.email,
            recommendation_count: 0,
          })
        }
        talentMap.get(row.id).recommendation_count++
      }
      const talent = [...talentMap.values()].sort((a, b) =>
        b.recommendation_count - a.recommendation_count || a.display_name.localeCompare(b.display_name)
      )

      // Get invite statuses
      const inviteRes = await query(`
        SELECT DISTINCT ON (p.id)
          p.display_name AS name,
          ri.status
        FROM role_invites ri
        JOIN people p ON p.id = ri.invitee_id
        WHERE ri.role_id = $1
        ORDER BY p.id, CASE WHEN ri.status = 'completed' THEN 0 ELSE 1 END, ri.created_at DESC
      `, [role.id])

      const inviteConnectors = inviteRes.rows
      const inviteStatus = {
        total: inviteConnectors.length,
        completed: inviteConnectors.filter(c => c.status === 'completed').length,
        connectors: inviteConnectors.map(c => ({ name: c.name, status: c.status })),
      }

      res.writeHead(200)
      res.end(JSON.stringify({
        role: {
          slug: role.slug,
          jobFunction: role.job_function,
          level: role.level,
          specialSkills: role.special_skills,
          status: role.status,
          createdAt: role.created_at,
        },
        talent,
        inviteStatus,
      }))
    } catch (err) {
      console.error('[/api/role/:slug error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  // ─── Submit role-specific vouch (token-based) ──────────────────────
  if (req.method === 'POST' && req.url === '/api/submit-role-vouch') {
    if (isRateLimited(req)) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }))
      return
    }
    const client = await getClient()
    try {
      const body = await readBody(req)
      const { token, roleSlug, recommendations } = body

      if (!token) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'token is required' }))
        client.release()
        return
      }

      // Look up role invite
      const inviteRes = await query(`
        SELECT ri.id, ri.role_id, ri.inviter_id, ri.invitee_id, ri.status,
               p.display_name,
               r.slug AS role_slug
        FROM role_invites ri
        JOIN people p ON p.id = ri.invitee_id
        JOIN roles r ON r.id = ri.role_id
        WHERE ri.token = $1
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
      const roleId = invite.role_id

      await client.query('BEGIN')

      // Create submission record
      const subRes = await client.query(`
        INSERT INTO submissions (submitter_id, form_type, submitted_at, raw_payload)
        VALUES ($1, 'role_vouch', NOW(), $2)
        RETURNING id
      `, [voucherId, JSON.stringify(body)])
      const submissionId = subRes.rows[0].id

      // Process each recommendation
      const vouchedPeople = []

      for (const r of (recommendations || [])) {
        if (!r?.linkedin || !r?.name) continue
        const talentUrl = normalizeLinkedInUrl(r.linkedin)
        if (!talentUrl) continue

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

        // Insert into role_people (role-specific 1st degree talent)
        await client.query(`
          INSERT INTO role_people (role_id, person_id, recommender_id, submission_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (role_id, person_id, recommender_id) DO UPDATE
          SET submission_id = EXCLUDED.submission_id
        `, [roleId, talentId, voucherId, submissionId])

        // ALSO insert into main graph edges (vouch type)
        await client.query(`
          INSERT INTO edges (source_id, target_id, edge_type, submission_id)
          VALUES ($1, $2, 'vouch', $3)
          ON CONFLICT (source_id, target_id, edge_type)
          DO UPDATE SET submission_id = EXCLUDED.submission_id, created_at = NOW()
        `, [voucherId, talentId, submissionId])

        vouchedPeople.push({
          id: talentId, display_name: r.name,
          email: r.email || null, linkedin_url: talentUrl,
        })
      }

      // Mark role invite as completed
      await client.query(`
        UPDATE role_invites SET status = 'completed'
        WHERE id = $1
      `, [invite.id])

      // For updates: create a new pending role invite so they can update later
      if (isUpdate) {
        const newToken = crypto.randomUUID()
        await client.query(
          `INSERT INTO role_invites (token, role_id, inviter_id, invitee_id) VALUES ($1, $2, $3, $4)`,
          [newToken, roleId, invite.inviter_id, voucherId]
        )
      }

      await client.query('COMMIT')

      console.log(`[RoleVouch] ${invite.display_name} ${isUpdate ? 'updated' : 'submitted'} role vouches for ${vouchedPeople.length} people (role: ${invite.role_slug})`)

      res.writeHead(200)
      res.end(JSON.stringify({ ok: true }))

      // ── Post-commit async tasks (fire-and-forget) ──

      checkRoleReadiness(roleId).catch(err =>
        console.error('[RoleReadiness] Post-vouch check failed:', err.message)
      )

      checkAndNotifyReadiness(invite.inviter_id).catch(err =>
        console.error('[Readiness] Post-role-vouch check failed:', err.message)
      )

      // Send "you were vouched" emails to new talent people (sequential to avoid rate limits)
      ;(async () => {
        for (const talent of vouchedPeople) {
          if (!talent.email) continue
          try {
            const already = await query(
              `SELECT 1 FROM sent_emails WHERE recipient_id = $1 AND email_type = 'you_were_vouched' LIMIT 1`,
              [talent.id]
            )
            if (already.rows.length > 0) continue

            if (!(await canEmailRecipient(talent.id))) {
              console.log(`[Email] Daily cap reached for ${talent.display_name}, skipping you_were_vouched`)
              continue
            }

            const newToken = crypto.randomUUID()
            await query(
              `INSERT INTO vouch_invites (token, inviter_id, invitee_id) VALUES ($1, $2, $3)`,
              [newToken, voucherId, talent.id]
            )

            const resendId = await sendYouWereVouchedEmail(talent, newToken, invite.display_name)
            await query(
              `INSERT INTO sent_emails (recipient_id, email_type, reference_id, resend_id)
               VALUES ($1, 'you_were_vouched', $2, $3)
               ON CONFLICT DO NOTHING`,
              [talent.id, invite.id, resendId]
            )
          } catch (err) {
            console.error(`[Email] Failed to send you_were_vouched to ${talent.display_name}:`, err.message)
          }
          await sleep(600)
        }
      })()
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[/api/submit-role-vouch error]', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Internal server error' }))
    } finally {
      client.release()
    }
    return
  }

  // ─── Get user's roles (auth required) ──────────────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/my-roles/')) {
    try {
      const slug = req.url.split('/api/my-roles/')[1]
      if (!slug) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Slug is required' }))
        return
      }

      const session = await validateSession(req)
      if (!session) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Authentication required' }))
        return
      }

      const linkedinUrl = `https://linkedin.com/in/${slug.toLowerCase()}`
      if (session.linkedin_url !== linkedinUrl) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      const rolesRes = await query(`
        SELECT r.slug, r.job_function, r.level, r.special_skills, r.status, r.created_at,
               (SELECT COUNT(DISTINCT person_id) FROM role_people WHERE role_id = r.id) AS talent_count,
               (SELECT COUNT(DISTINCT invitee_id) FILTER (WHERE status = 'completed')
                FROM role_invites WHERE role_id = r.id) AS completed_count,
               (SELECT COUNT(DISTINCT invitee_id)
                FROM role_invites WHERE role_id = r.id) AS total_invites
        FROM roles r
        WHERE r.creator_id = $1
        ORDER BY r.created_at DESC
      `, [session.id])

      res.writeHead(200)
      res.end(JSON.stringify({ roles: rolesRes.rows }))
    } catch (err) {
      console.error('[/api/my-roles error]', err)
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
