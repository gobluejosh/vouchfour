import { query } from './db.js'
import { normalizeLinkedInUrl } from './linkedin.js'
import { normalizeOrgName } from './orgNormalize.js'

const APOLLO_API_KEY = process.env.APOLLO_API_KEY || ''
const BRAVE_API_KEY = process.env.BRAVE_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── Network-aware company fingerprint ─────────────────────────────────
// Uses the vouch network's shared employment data to identify the best
// disambiguation terms for Brave searches. Companies where many network
// members overlap are the strongest identity signals.

// Orgs too generic to be useful as search disambiguation
const SKIP_ORGS_FOR_FINGERPRINT = new Set([
  'unknown', 'self-employed', 'freelance', 'career break', 'independent',
  'retired', 'sabbatical', 'consultant', 'consulting',
])

// Large companies that are poor disambiguators (too many people globally)
const LOW_DISTINCTIVENESS_ORGS = new Set([
  'google', 'amazon', 'meta', 'facebook', 'apple', 'microsoft', 'netflix',
  'uber', 'salesforce', 'oracle', 'ibm', 'deloitte', 'accenture', 'pwc',
  'kpmg', 'ernst & young', 'ey', 'jp morgan', 'jpmorgan', 'goldman sachs',
  'morgan stanley', 'bank of america', 'wells fargo', 'citigroup',
])

// Cached network company map — computed once per server lifecycle
let _networkCompanyMap = null
let _networkCompanyMapAge = 0
const COMPANY_MAP_TTL = 1000 * 60 * 60 // 1 hour

/**
 * Build a map of { normalizedOrg → { name, count, distinctiveness } }
 * from all employment histories in the database.
 */
async function getNetworkCompanyMap() {
  if (_networkCompanyMap && (Date.now() - _networkCompanyMapAge) < COMPANY_MAP_TTL) {
    return _networkCompanyMap
  }

  const res = await query(`
    SELECT organization, COUNT(DISTINCT person_id) as people_count
    FROM employment_history
    WHERE organization IS NOT NULL
    GROUP BY organization
  `)

  const map = new Map()
  for (const row of res.rows) {
    const norm = normalizeOrgName(row.organization)
    if (!norm || SKIP_ORGS_FOR_FINGERPRINT.has(norm)) continue
    const count = parseInt(row.people_count)
    const existing = map.get(norm)
    if (existing) {
      existing.count += count // Combine counts for normalized aliases
      // Keep the longer/more descriptive spelling (e.g., "Guild Education" over "Guild")
      if (row.organization.trim().length > existing.name.length) {
        existing.name = row.organization.trim()
      }
    } else {
      const isLowDistinctiveness = LOW_DISTINCTIVENESS_ORGS.has(norm)
      map.set(norm, {
        name: row.organization.trim(),
        count,
        distinctiveness: isLowDistinctiveness ? 0.2 : 1.0,
      })
    }
  }

  _networkCompanyMap = map
  _networkCompanyMapAge = Date.now()
  console.log(`[Enrich] Network company map: ${map.size} unique orgs`)
  return map
}

/**
 * Build a disambiguation fingerprint for a person using their employment
 * history cross-referenced with the network company map.
 *
 * Returns { companies: string[], industry: string|null }
 * where companies are the 2-3 best disambiguation terms, ordered by score.
 */
export async function buildFingerprint(personId) {
  const networkMap = await getNetworkCompanyMap()

  // Get this person's employment history
  const histRes = await query(`
    SELECT organization, title, start_date, end_date, is_current
    FROM employment_history WHERE person_id = $1
    ORDER BY start_date DESC NULLS LAST
  `, [personId])

  // Get industry from people table
  const personRes = await query('SELECT industry FROM people WHERE id = $1', [personId])
  const industry = personRes.rows[0]?.industry || null

  // Score each company this person worked at
  const scored = []
  const seenNorm = new Set()
  for (const job of histRes.rows) {
    const norm = normalizeOrgName(job.organization)
    if (!norm || SKIP_ORGS_FOR_FINGERPRINT.has(norm) || seenNorm.has(norm)) continue
    seenNorm.add(norm)

    const networkData = networkMap.get(norm)
    const networkCount = networkData?.count || 0
    const distinctiveness = networkData?.distinctiveness || 0.8

    // Tenure bonus — longer tenure = more likely to appear in their web presence
    let tenureYears = 0
    if (job.start_date) {
      const start = new Date(job.start_date)
      const end = job.is_current ? new Date() : (job.end_date ? new Date(job.end_date) : new Date())
      tenureYears = (end - start) / (1000 * 60 * 60 * 24 * 365)
    }

    // Seniority bonus — higher titles more likely to appear in press/content
    const titleLower = (job.title || '').toLowerCase()
    const seniorityBonus =
      /\b(ceo|cto|coo|cfo|president|founder|co-founder|partner)\b/.test(titleLower) ? 2.0 :
      /\b(vp|vice president|svp|evp|director|head of|managing)\b/.test(titleLower) ? 1.5 :
      1.0

    // Combined score: network importance × distinctiveness × tenure × seniority
    const score = (networkCount * distinctiveness) + (tenureYears * 0.5) + (seniorityBonus * 0.5)

    scored.push({
      name: networkData?.name || job.organization.trim(),
      norm,
      score,
      networkCount,
      distinctiveness,
    })
  }

  // Sort by score descending, take top 3
  scored.sort((a, b) => b.score - a.score)
  const companies = scored.slice(0, 3).map(s => s.name)

  return { companies, industry }
}

// ── Brave result post-filter ─────────────────────────────────────────
// Noise domains that just scrape/regurgitate profile data
const NOISE_DOMAINS = new Set([
  'linkedin.com', 'zoominfo.com', 'rocketreach.co', 'signalhire.com',
  'leadiq.com', 'apollo.io', 'lusha.com', 'contactout.com', 'seamless.ai',
  'snov.io', 'hunter.io', 'clearbit.com', 'peopledatalabs.com',
  'theorg.com', 'org.com', 'dnb.com', 'crunchbase.com',
  'pitchbook.com', 'owler.com', 'glassdoor.com', 'indeed.com',
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'tiktok.com', 'pinterest.com',
])

/**
 * Filter Brave results to keep only those likely about the right person.
 * Uses fingerprint companies + name as validation signals.
 */
function filterBraveResults(results, fingerprint, personName) {
  const fpTerms = fingerprint.companies.map(c => c.toLowerCase())
  if (fingerprint.industry) fpTerms.push(fingerprint.industry.toLowerCase())

  return results.filter(r => {
    // Always skip noise domains
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, '')
      if (NOISE_DOMAINS.has(host)) return false
      // Also skip if a subdomain of a noise domain
      for (const nd of NOISE_DOMAINS) {
        if (host.endsWith('.' + nd)) return false
      }
    } catch {}

    // Check if result mentions any fingerprint term
    const text = `${r.title || ''} ${r.description || ''}`.toLowerCase()
    const hasFingerprint = fpTerms.some(term => text.includes(term))

    // If we have fingerprint terms and the result mentions none, skip it
    if (fpTerms.length > 0 && !hasFingerprint) return false

    return true
  })
}

// ── Name mismatch guard (the "Lee Mayer" / "Brian Egan" cases) ─────────
// Apollo sometimes returns a different person for a LinkedIn URL.
// We require both first and last name to match (with fuzzy handling
// for nicknames, hyphens, and close spellings).

const NICKNAMES = {
  jim: 'james', james: 'jim', alex: 'alexander', alexander: 'alex',
  greg: 'gregory', gregory: 'greg', bill: 'william', william: 'bill',
  bob: 'robert', robert: 'bob', mike: 'michael', michael: 'mike',
  dan: 'daniel', daniel: 'dan', ben: 'benjamin', benjamin: 'ben',
  jon: 'jonathan', jonathan: 'jon', chris: 'christopher', christopher: 'chris',
  matt: 'matthew', matthew: 'matt', nick: 'nicholas', nicholas: 'nick',
  tom: 'thomas', thomas: 'tom', joe: 'joseph', joseph: 'joe',
  art: 'arthur', arthur: 'art', ed: 'edward', edward: 'ed',
  ted: 'theodore', theodore: 'ted', kate: 'katherine', katherine: 'kate',
  liz: 'elizabeth', elizabeth: 'liz', beth: 'elizabeth',
  rick: 'richard', richard: 'rick', dick: 'richard',
  steve: 'steven', steven: 'steve', steph: 'stephanie', stephanie: 'steph',
  tony: 'anthony', anthony: 'tony', dave: 'david', david: 'dave',
  sam: 'samuel', samuel: 'sam', pat: 'patrick', patrick: 'pat',
  jen: 'jennifer', jennifer: 'jen', jenn: 'jennifer',
  rob: 'robert', will: 'william', tim: 'timothy', timothy: 'tim',
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

function tokenMatch(t1, t2) {
  if (t1 === t2) return true
  if (NICKNAMES[t1] === t2 || NICKNAMES[t2] === t1) return true
  // Prefix match (len ≥ 3): "Art"→"Arthur", "Ben"→"Benjamin"
  if (t1.length >= 3 && t2.startsWith(t1)) return true
  if (t2.length >= 3 && t1.startsWith(t2)) return true
  // Levenshtein ≤ 1 for names > 4 chars: "Zagozdan"→"Zagozdon", "Atieh"→"Atiah"
  if (t1.length > 4 && t2.length > 4 && levenshtein(t1, t2) <= 1) return true
  return false
}

function namesMatch(stored, returned) {
  if (!stored || !returned) return false
  // Split on spaces AND hyphens so "Corder-Paul" → ["corder","paul"]
  const tokenize = s => s.toLowerCase().split(/[\s-]+/).filter(t => t.length > 0)
  const a = tokenize(stored)
  const b = tokenize(returned)

  if (a.length >= 2 && b.length >= 2) {
    const firstMatch = tokenMatch(a[0], b[0]) || b.some(t => tokenMatch(a[0], t))
    const lastMatch = tokenMatch(a[a.length - 1], b[b.length - 1]) || b.some(t => tokenMatch(a[a.length - 1], t))
    return firstMatch && lastMatch
  }
  // Fallback for single-name entries
  return a.some(t1 => t1.length > 1 && b.some(t2 => tokenMatch(t1, t2)))
}

// ── Extract structured fields from Apollo person object ────────────────
function extractApolloFields(person) {
  const locationParts = [person.city, person.state, person.country].filter(Boolean)
  const currentJob = (person.employment_history || []).find(e => e.current)

  return {
    current_title: person.title || currentJob?.title || null,
    current_company: person.organization?.name || currentJob?.organization_name || null,
    location: locationParts.length > 0 ? locationParts.join(', ') : null,
    seniority: person.seniority || null,
    industry: person.organization?.industry || null,
    headline: person.headline || null,
    photo_url: person.photo_url || null,
  }
}

// ── Save Apollo data to DB (people fields + employment_history + person_enrichment)
export async function saveApolloData(personId, displayName, apolloData) {
  const person = apolloData.person
  if (!person) return false

  // Name mismatch guard
  if (!namesMatch(displayName, person.name)) {
    console.log(`[Enrich] Apollo name mismatch: stored="${displayName}" vs returned="${person.name}", skipping`)
    return false
  }

  const fields = extractApolloFields(person)

  // Update people top-line fields (COALESCE to not overwrite with nulls)
  await query(`
    UPDATE people SET
      current_title   = COALESCE($2, current_title),
      current_company = COALESCE($3, current_company),
      location        = COALESCE($4, location),
      seniority       = COALESCE($5, seniority),
      industry        = COALESCE($6, industry),
      headline        = COALESCE($7, headline),
      photo_url       = COALESCE($8, photo_url),
      updated_at      = NOW()
    WHERE id = $1
  `, [personId, fields.current_title, fields.current_company, fields.location,
      fields.seniority, fields.industry, fields.headline, fields.photo_url])

  // Replace employment history (delete + insert for idempotent re-enrichment)
  // Skip if user has manually edited their career history
  const editCheck = await query('SELECT career_edited_at FROM people WHERE id = $1', [personId])
  if (!editCheck.rows[0]?.career_edited_at) {
    await query('DELETE FROM employment_history WHERE person_id = $1', [personId])

    const history = person.employment_history || []
    for (const job of history) {
      await query(`
        INSERT INTO employment_history (person_id, organization, title, start_date, end_date, is_current, location, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        personId,
        job.organization_name || 'Unknown',
        job.title || null,
        job.start_date || null,
        job.end_date || null,
        job.current || false,
        null,
        null,
      ])
    }
  }

  // Upsert into person_enrichment
  await query(`
    INSERT INTO person_enrichment (person_id, source, raw_payload, enriched_at)
    VALUES ($1, 'apollo', $2, NOW())
    ON CONFLICT (person_id, source) DO UPDATE
    SET raw_payload = EXCLUDED.raw_payload, enriched_at = NOW()
  `, [personId, JSON.stringify(apolloData)])

  return true
}

// ── Summary Generation (callable independently) ────────────────────────
// Generates full AI summary + compact summary from all available data.
// Called by enrichPerson Step C, and also directly after expertise extraction
// for the career-edit pipeline (so summary includes expertise chunks).
export async function generateSummary(personId, { braveSnippets = [] } = {}) {
  const start = Date.now()

  // Load person basics
  const personRes = await query(
    'SELECT id, display_name, linkedin_url, current_title, current_company, location, industry, headline FROM people WHERE id = $1',
    [personId]
  )
  const person = personRes.rows[0]
  if (!person) throw new Error(`Person ${personId} not found`)

  // Gather comprehensive data in parallel
  const [dbHistoryRes, apolloEnrichRes, vouchRes, contentRes, expertiseRes, braveEnrichRes] = await Promise.all([
    query(`SELECT organization, title, start_date, end_date, is_current, location, description
           FROM employment_history WHERE person_id = $1
           ORDER BY start_date DESC NULLS LAST`, [personId]),
    query(`SELECT raw_payload FROM person_enrichment
           WHERE person_id = $1 AND source = 'apollo'`, [personId]),
    query(`SELECT jf.name as function_name, p.display_name as voucher_name, p.current_company as voucher_company
           FROM vouches v
           JOIN job_functions jf ON jf.id = v.job_function_id
           JOIN people p ON p.id = v.voucher_id
           WHERE v.vouchee_id = $1`, [personId]),
    query(`SELECT content_type, title, content_summary, topics
           FROM person_content WHERE person_id = $1
           ORDER BY content_type, id`, [personId]),
    query(`SELECT chunk_type, chunk_text, tags
           FROM person_expertise WHERE person_id = $1 AND chunk_type != 'bio'
           ORDER BY chunk_type, id`, [personId]),
    // Load Brave snippets from DB if not passed in (standalone call vs enrichPerson)
    braveSnippets.length === 0
      ? query(`SELECT raw_payload FROM person_enrichment WHERE person_id = $1 AND source = 'brave'`, [personId])
      : Promise.resolve({ rows: [] }),
  ])

  // If no braveSnippets passed in, reconstruct from DB
  if (braveSnippets.length === 0 && braveEnrichRes.rows[0]?.raw_payload) {
    const payload = typeof braveEnrichRes.rows[0].raw_payload === 'string'
      ? JSON.parse(braveEnrichRes.rows[0].raw_payload) : braveEnrichRes.rows[0].raw_payload
    const allResults = [...(payload.results1 || []), ...(payload.results2 || []), ...(payload.results3 || [])]
    const seen = new Set()
    for (const r of allResults) {
      if (!r.url || seen.has(r.url)) continue
      seen.add(r.url)
      braveSnippets.push({ title: r.title || '', description: r.description || '', url: r.url })
    }
  }

  // Build rich prompt
  let promptParts = [`Build a professional profile summary for: ${person.display_name}`]
  if (person.linkedin_url) promptParts.push(`LinkedIn: ${person.linkedin_url}`)
  if (person.current_title && person.current_company) promptParts.push(`Current role: ${person.current_title} at ${person.current_company}`)
  else if (person.current_company) promptParts.push(`Current company: ${person.current_company}`)
  else if (person.current_title) promptParts.push(`Current title: ${person.current_title}`)

  if (person.location) promptParts.push(`Location: ${person.location}`)
  if (person.industry) promptParts.push(`Industry: ${person.industry}`)
  if (person.headline) promptParts.push(`Headline: ${person.headline}`)

  // Apollo org data (only if the cached Apollo person matches — guards against stale test data)
  if (apolloEnrichRes.rows[0]?.raw_payload) {
    const apolloData = typeof apolloEnrichRes.rows[0].raw_payload === 'string'
      ? JSON.parse(apolloEnrichRes.rows[0].raw_payload) : apolloEnrichRes.rows[0].raw_payload
    const apolloPersonName = apolloData.person?.name
    const apolloNameOk = !apolloPersonName || namesMatch(person.display_name, apolloPersonName)
    const org = apolloNameOk ? (apolloData.person?.organization || apolloData.organization) : null
    if (org) {
      const orgParts = []
      if (org.estimated_num_employees) orgParts.push(`~${org.estimated_num_employees} employees`)
      if (org.total_funding_printed) orgParts.push(`$${org.total_funding_printed} funding`)
      if (org.latest_funding_stage) orgParts.push(`stage: ${org.latest_funding_stage}`)
      if (org.founded_year) orgParts.push(`founded ${org.founded_year}`)
      if (orgParts.length > 0) promptParts.push(`Current company details: ${org.name || person.current_company} — ${orgParts.join(', ')}`)
      if (org.short_description) promptParts.push(`Company description: ${org.short_description.slice(0, 300)}`)
    }
  }

  // Employment history from DB
  if (dbHistoryRes.rows.length > 0) {
    const historyStr = dbHistoryRes.rows
      .map(j => {
        const loc = j.location ? ` (${j.location})` : ''
        const desc = j.description ? ` — ${j.description}` : ''
        return `- ${j.title || 'Unknown role'} at ${j.organization || 'Unknown'} (${j.start_date || '?'} – ${j.is_current ? 'Present' : j.end_date || '?'})${loc}${desc}`
      })
      .join('\n')
    promptParts.push(`\nCareer history (${dbHistoryRes.rows.length} roles):\n${historyStr}`)
  }

  // Vouch context
  if (vouchRes.rows.length > 0) {
    const vouchStr = vouchRes.rows
      .map(v => `- Vouched for in ${v.function_name} by ${v.voucher_name}${v.voucher_company ? ` (${v.voucher_company})` : ''}`)
      .join('\n')
    promptParts.push(`\nVouch context:\n${vouchStr}`)
  }

  // Discovered content
  if (contentRes.rows.length > 0) {
    const contentStr = contentRes.rows.slice(0, 10)
      .map(c => {
        const topics = c.topics?.length > 0 ? ` [topics: ${c.topics.join(', ')}]` : ''
        const summary = c.content_summary ? ` — ${c.content_summary}` : ''
        return `- [${c.content_type}] ${c.title}${summary}${topics}`
      })
      .join('\n')
    promptParts.push(`\nDiscovered content (${contentRes.rows.length} items):\n${contentStr}`)
  }

  // Pre-extracted expertise chunks — richest career analysis
  if (expertiseRes.rows.length > 0) {
    const expertiseStr = expertiseRes.rows
      .map(e => {
        const tags = e.tags?.length > 0 ? ` [${e.tags.join(', ')}]` : ''
        return `- [${e.chunk_type}] ${e.chunk_text}${tags}`
      })
      .join('\n')
    promptParts.push(`\nExpertise analysis (${expertiseRes.rows.length} signals — use these to highlight what makes this person distinctive):\n${expertiseStr}`)
  }

  // Brave web snippets
  if (braveSnippets.length > 0) {
    const snippetStr = braveSnippets
      .slice(0, 12)
      .map(s => `- ${s.title}: ${s.description}`)
      .join('\n')
    promptParts.push(`\nRecent web mentions:\n${snippetStr}`)
  }

  const userPrompt = promptParts.join('\n')

  // Retry loop for rate limits
  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: `Write a professional summary paragraph about this person.

Include if available:
- Current role and company (with company context like size/stage when notable)
- Career trajectory and notable past roles — emphasize distinctive transitions and scaling moments
- Public content they've created (blog posts, podcast appearances, talks, open-source contributions)
- Areas of expertise and what they're known for (use vouch context as a signal)
- Recent professional activity or news

IMPORTANT RULES:
- Output ONLY the summary paragraph. No preamble, reasoning, labels, or commentary.
- Never start with "Based on the search results" or similar meta-commentary.
- Never start with the person's name (e.g., "John Smith is..."). Start with the role or a distinctive career fact.
- The structured data (career history, title, company) is authoritative. Web mentions may reference other people with the same name — only include web mentions that clearly match the person's known role, company, or industry.
- Do not include LinkedIn connection counts or other social media metrics.
- If data is limited, write a shorter summary (2-3 sentences) with what you have. Do not pad with hedging language like "it is difficult to determine" or "without more information."
- 3-6 sentences. Be factual and direct.`,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      const data = await claudeRes.json()

      if (data.type === 'error' && data.error?.type === 'rate_limit_error') {
        const backoff = attempt * 15000
        console.warn(`[Summary] Rate limited (attempt ${attempt}/${MAX_RETRIES}) | ${person.display_name} | retrying in ${backoff/1000}s`)
        clearTimeout(timeout)
        if (attempt < MAX_RETRIES) { await sleep(backoff); continue }
        await query(`
          INSERT INTO person_enrichment (person_id, source, raw_payload, enriched_at)
          VALUES ($1, 'claude', $2, NOW())
          ON CONFLICT (person_id, source) DO UPDATE SET raw_payload = EXCLUDED.raw_payload, enriched_at = NOW()
        `, [personId, JSON.stringify(data)])
        return 'rate_limited'
      }

      const aiSummary = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

      await query(`
        INSERT INTO person_enrichment (person_id, source, raw_payload, ai_summary, enriched_at)
        VALUES ($1, 'claude', $2, $3, NOW())
        ON CONFLICT (person_id, source) DO UPDATE
        SET raw_payload = EXCLUDED.raw_payload, ai_summary = EXCLUDED.ai_summary, enriched_at = NOW()
      `, [personId, JSON.stringify(data), aiSummary || null])

      console.log(`[Summary] ${person.display_name} | ${(aiSummary || '').length} chars | ${Date.now() - start}ms`)

      // Generate compact summary for Network Brain context
      if (aiSummary) {
        try {
          const compactRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 128,
              system: 'Compress this professional summary into 1-2 sentences (max 40 words). Include: current role + company, 1-2 key career highlights. Drop: education, LinkedIn metrics, generic descriptors. Output ONLY the compressed summary, nothing else.',
              messages: [{ role: 'user', content: aiSummary }],
            }),
          })
          const compactData = await compactRes.json()
          const compactSummary = (compactData.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
          if (compactSummary) {
            await query(`
              INSERT INTO person_enrichment (person_id, source, raw_payload, ai_summary, enriched_at)
              VALUES ($1, 'claude-compact', '{}', $2, NOW())
              ON CONFLICT (person_id, source) DO UPDATE SET ai_summary = EXCLUDED.ai_summary, enriched_at = NOW()
            `, [personId, compactSummary])
            console.log(`[Summary] Compact ${person.display_name} | ${compactSummary.length} chars`)
          }
        } catch (compactErr) {
          console.warn(`[Summary] Compact failed | ${person.display_name}:`, compactErr.message)
        }
      }

      return aiSummary ? 'ok' : 'empty'
    } finally {
      clearTimeout(timeout)
    }
  }
  return 'failed'
}


// ── Main enrichment pipeline ───────────────────────────────────────────
export async function enrichPerson(personId) {
  const overallStart = Date.now()
  const steps = { apollo: 'skipped', brave: 'skipped', claude: 'skipped' }

  // Load person
  const personRes = await query(
    'SELECT id, linkedin_url, email, display_name, enriched_at FROM people WHERE id = $1',
    [personId]
  )
  const person = personRes.rows[0]
  if (!person) {
    console.log(`[Enrich] Person ${personId} not found, skipping`)
    return { personId, steps }
  }

  console.log(`[Enrich] Starting enrichment for ${person.display_name} (id=${personId})`)

  // Context accumulator — builds up across steps
  const context = {
    name: person.display_name,
    linkedinUrl: person.linkedin_url,
    email: person.email,
    title: null,
    company: null,
    notablePastCompany: null,
    employmentHistory: [],
    braveSnippets: [],
  }

  // ── Step A: Apollo ──────────────────────────────────────────────────
  try {
    const start = Date.now()

    // Check for cached Apollo data (within last 30 days)
    const cached = await query(
      `SELECT raw_payload FROM person_enrichment
       WHERE person_id = $1 AND source = 'apollo' AND enriched_at > NOW() - INTERVAL '30 days'`,
      [personId]
    )

    let apolloData = null

    if (cached.rows.length > 0) {
      const cachedPayload = typeof cached.rows[0].raw_payload === 'string'
        ? JSON.parse(cached.rows[0].raw_payload) : cached.rows[0].raw_payload
      // Validate cached Apollo data still matches this person (guards against stale test data)
      if (cachedPayload?.person?.name && !namesMatch(person.display_name, cachedPayload.person.name)) {
        console.log(`[Enrich] Apollo cache name mismatch: stored="${person.display_name}" vs cached="${cachedPayload.person.name}", deleting stale record`)
        await query('DELETE FROM person_enrichment WHERE person_id = $1 AND source = $2', [personId, 'apollo'])
        steps.apollo = 'name_mismatch'
      } else {
        console.log(`[Enrich] Apollo ${Date.now() - start}ms | ${person.display_name} | cached`)
        apolloData = cachedPayload
        steps.apollo = 'cached'
      }
    } else if (APOLLO_API_KEY && person.linkedin_url) {
      const normalizedUrl = normalizeLinkedInUrl(person.linkedin_url)
      const reqBody = { linkedin_url: normalizedUrl || person.linkedin_url, reveal_personal_emails: true }
      if (person.email) reqBody.email = person.email

      const apolloRes = await fetch('https://api.apollo.io/api/v1/people/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': APOLLO_API_KEY },
        body: JSON.stringify(reqBody),
      })

      if (apolloRes.ok) {
        apolloData = await apolloRes.json()
        const saved = await saveApolloData(personId, person.display_name, apolloData)
        steps.apollo = saved ? 'ok' : 'name_mismatch'
        console.log(`[Enrich] Apollo ${Date.now() - start}ms | ${person.display_name} | ${steps.apollo}`)
      } else {
        console.warn(`[Enrich] Apollo ${Date.now() - start}ms | ${person.display_name} | HTTP ${apolloRes.status}`)
        steps.apollo = 'error'
      }
    } else {
      console.log(`[Enrich] Apollo skipped | ${person.display_name} | no API key or LinkedIn URL`)
    }

    // Extract context for downstream steps (only if Apollo data was saved or cached — skip on name mismatch)
    if (apolloData?.person && steps.apollo !== 'name_mismatch') {
      const ap = apolloData.person
      context.title = ap.title || null
      context.company = ap.organization?.name || null
      context.employmentHistory = ap.employment_history || []
      const pastJobs = context.employmentHistory
        .filter(e => !e.current)
        .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
      context.notablePastCompany = pastJobs[0]?.organization_name || null
    }

    // Fall back to DB fields if Apollo didn't provide context (e.g. name mismatch or skipped)
    if (!context.title || !context.company) {
      const dbRes = await query('SELECT current_title, current_company FROM people WHERE id = $1', [personId])
      if (dbRes.rows[0]) {
        context.title = context.title || dbRes.rows[0].current_title || null
        context.company = context.company || dbRes.rows[0].current_company || null
      }
    }
  } catch (err) {
    console.error(`[Enrich] Apollo error | ${person.display_name}:`, err.message)
    steps.apollo = 'error'
  }

  // ── Step B: Brave Search (network-aware fingerprint queries) ────────
  try {
    const start = Date.now()

    // Build disambiguation fingerprint from network data
    const fingerprint = await buildFingerprint(personId)
    const fpCompanies = fingerprint.companies

    // Build OR clause from fingerprint companies for disambiguation
    // e.g. ("Craftsy" OR "Guild Education" OR "Anuvi")
    const disambigTerms = fpCompanies.length > 0
      ? `(${fpCompanies.map(c => `"${c}"`).join(' OR ')})`
      : (context.company ? `"${context.company}"` : '')

    // Query 1: Professional presence (disambiguated)
    // "Josh Scott" ("Craftsy" OR "Guild Education" OR "Anuvi")
    const braveQuery1 = disambigTerms
      ? `"${context.name}" ${disambigTerms}`
      : `"${context.name}" ${context.company || ''}`

    // Query 2: Written content (disambiguated)
    // "Josh Scott" ("Craftsy" OR "Guild Education") blog OR article OR wrote OR published
    const braveQuery2 = disambigTerms
      ? `"${context.name}" ${disambigTerms} blog OR article OR wrote OR published OR newsletter`
      : `"${context.name}" ${context.company || ''} blog OR article`

    // Query 3: Speaking & appearances (disambiguated)
    // "Josh Scott" ("Craftsy" OR "Guild Education") podcast OR interview OR keynote OR speaker
    const braveQuery3 = disambigTerms
      ? `"${context.name}" ${disambigTerms} podcast OR interview OR keynote OR speaker OR conference`
      : `"${context.name}" ${context.company || ''} podcast OR interview`

    const braveSearch = async (q) => {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY,
        },
      })
      return r.json()
    }

    const data1 = await braveSearch(braveQuery1)
    await sleep(500)
    const data2 = await braveSearch(braveQuery2)
    await sleep(500)
    const data3 = await braveSearch(braveQuery3)

    const results1 = data1.web?.results || []
    const results2 = data2.web?.results || []
    const results3 = data3.web?.results || []
    const totalResults = results1.length + results2.length + results3.length

    // Post-filter: remove noise domains and results that don't match the fingerprint
    const filtered1 = filterBraveResults(results1, fingerprint, context.name)
    const filtered2 = filterBraveResults(results2, fingerprint, context.name)
    const filtered3 = filterBraveResults(results3, fingerprint, context.name)
    const filteredTotal = filtered1.length + filtered2.length + filtered3.length

    // Save combined results (both raw and filtered for debugging)
    const payload = {
      fingerprint: { companies: fpCompanies, industry: fingerprint.industry },
      query1: braveQuery1, query2: braveQuery2, query3: braveQuery3,
      results1: filtered1, results2: filtered2, results3: filtered3,
      rawCounts: { q1: results1.length, q2: results2.length, q3: results3.length },
      filteredCounts: { q1: filtered1.length, q2: filtered2.length, q3: filtered3.length },
    }
    await query(`
      INSERT INTO person_enrichment (person_id, source, raw_payload, enriched_at)
      VALUES ($1, 'brave', $2, NOW())
      ON CONFLICT (person_id, source) DO UPDATE
      SET raw_payload = EXCLUDED.raw_payload, enriched_at = NOW()
    `, [personId, JSON.stringify(payload)])

    // Build snippets for Claude context (from filtered results)
    const allFiltered = [...filtered1, ...filtered2, ...filtered3]
    const seen = new Set()
    for (const r of allFiltered) {
      if (seen.has(r.url)) continue
      seen.add(r.url)
      context.braveSnippets.push({ title: r.title || '', description: r.description || '', url: r.url || '' })
    }

    steps.brave = 'ok'
    console.log(`[Enrich] Brave ${Date.now() - start}ms | ${person.display_name} | ${totalResults} raw → ${filteredTotal} filtered | fp: [${fpCompanies.join(', ')}]`)
  } catch (err) {
    console.error(`[Enrich] Brave error | ${person.display_name}:`, err.message)
    steps.brave = 'error'
  }

  // ── Step C: Claude synthesis ────────────────────────────────────────
  try {
    const result = await generateSummary(personId, { braveSnippets: context.braveSnippets })
    steps.claude = result
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[Enrich] Claude timed out after 45s | ${person.display_name}`)
    } else {
      console.error(`[Enrich] Claude error | ${person.display_name}:`, err.message)
    }
    steps.claude = 'error'
  }

  // ── Finalize ────────────────────────────────────────────────────────
  await query('UPDATE people SET enriched_at = NOW(), review_status = $2 WHERE id = $1', [personId, 'pending'])

  console.log(`[Enrich] Complete | ${person.display_name} | apollo=${steps.apollo} brave=${steps.brave} claude=${steps.claude} | ${Date.now() - overallStart}ms`)
  return { personId, steps }
}

// ── Batch enrichment ───────────────────────────────────────────────────
let enrichBatchRunning = false

export async function enrichBatch(personIds, { delayMs = 5000 } = {}) {
  if (enrichBatchRunning) {
    console.log('[Enrich] Batch already running, skipping')
    return []
  }
  enrichBatchRunning = true

  const results = []
  console.log(`[Enrich] Batch started: ${personIds.length} people`)

  try {
    for (let i = 0; i < personIds.length; i++) {
      try {
        const result = await enrichPerson(personIds[i])
        results.push(result)
      } catch (err) {
        console.error(`[Enrich] Batch error for person ${personIds[i]}:`, err.message)
        results.push({ personId: personIds[i], steps: { apollo: 'error', brave: 'error', claude: 'error' } })
      }
      if (i < personIds.length - 1) {
        await sleep(delayMs)
      }
    }
    console.log(`[Enrich] Batch complete: ${results.length}/${personIds.length} people processed`)
  } finally {
    enrichBatchRunning = false
  }

  return results
}

// ── LinkedIn Connection Enrichment (lightweight: Brave + Claude only) ──

/**
 * Enrich a single LinkedIn connection with Brave search + Claude summary.
 * Skips Apollo. Updates ai_summary + enriched_at on linkedin_connections.
 * Re-embeds with richer text after enrichment.
 * @param {number} connectionId - linkedin_connections.id
 */
export async function enrichLinkedInConnection(connectionId) {
  const connRes = await query(
    'SELECT id, first_name, last_name, display_name, title, company, linkedin_url, enriched_at FROM linkedin_connections WHERE id = $1',
    [connectionId]
  )
  const conn = connRes.rows[0]
  if (!conn) return { connectionId, status: 'not_found' }
  if (conn.enriched_at) return { connectionId, status: 'already_enriched' }

  const name = conn.display_name
  const company = conn.company || ''
  const title = conn.title || ''
  const start = Date.now()

  // ── Brave Search (1 query, professional presence) ──
  let braveSnippets = []
  try {
    if (!BRAVE_API_KEY) throw new Error('BRAVE_API_KEY not set')
    const disambig = company ? `"${company}"` : ''
    const braveQuery = disambig ? `"${name}" ${disambig}` : `"${name}" ${title}`

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(braveQuery)}&count=10`
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_API_KEY },
    })
    const data = await r.json()
    const results = data.web?.results || []

    // Filter noise domains; use company as simple fingerprint
    const fingerprint = { companies: company ? [company] : [], industry: null }
    const filtered = filterBraveResults(results, fingerprint, name)

    const seen = new Set()
    for (const r of filtered) {
      if (seen.has(r.url)) continue
      seen.add(r.url)
      braveSnippets.push({ title: r.title || '', description: r.description || '', url: r.url || '' })
    }
    console.log(`[Enrich-LC] Brave ${Date.now() - start}ms | ${name} | ${results.length} raw → ${filtered.length} filtered`)
  } catch (err) {
    console.error(`[Enrich-LC] Brave error | ${name}:`, err.message)
  }

  // ── Claude Summary (2-3 sentences) ──
  let aiSummary = null
  try {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')

    let userPrompt = `Person: ${name}\n`
    if (title) userPrompt += `Current title: ${title}\n`
    if (company) userPrompt += `Current company: ${company}\n`
    if (conn.linkedin_url) userPrompt += `LinkedIn: ${conn.linkedin_url}\n`
    if (braveSnippets.length > 0) {
      userPrompt += `\nWeb mentions:\n`
      for (const s of braveSnippets.slice(0, 8)) {
        userPrompt += `- ${s.title}: ${s.description}\n`
      }
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        system: `Write a 2-3 sentence professional summary about this person.
Include if available: current role, career highlights, areas of expertise.
RULES:
- Output ONLY the summary. No preamble or commentary.
- Never start with the person's name.
- Only include web mentions that clearly match this person's role/company.
- If data is limited, write a shorter summary with what you have. Do not pad with hedging language.
- Be factual and direct.`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    const claudeData = await claudeRes.json()
    if (claudeData.content?.[0]?.text) {
      aiSummary = claudeData.content[0].text.trim()
    }
    console.log(`[Enrich-LC] Claude ${Date.now() - start}ms | ${name} | ${aiSummary ? aiSummary.length + ' chars' : 'no summary'}`)
  } catch (err) {
    console.error(`[Enrich-LC] Claude error | ${name}:`, err.message)
  }

  if (!aiSummary) return { connectionId, status: 'no_summary' }

  // ── Save summary + re-embed ──
  await query(
    'UPDATE linkedin_connections SET ai_summary = $1, enriched_at = NOW() WHERE id = $2',
    [aiSummary, connectionId]
  )

  // Re-embed with richer text
  try {
    // Delete old embedding
    await query('DELETE FROM linkedin_connection_embeddings WHERE connection_id = $1', [connectionId])

    // Build richer embedding text
    const parts = []
    if (title && company) parts.push(`${title} at ${company}`)
    else if (title) parts.push(title)
    else if (company) parts.push(company)
    parts.push(aiSummary)
    const embeddingText = parts.join('. ')

    // Import getEmbeddings dynamically to avoid circular deps
    const { getEmbeddings, toVectorLiteral } = await import('./embeddings.js')
    const [embedding] = await getEmbeddings([embeddingText])
    await query(`
      INSERT INTO linkedin_connection_embeddings (connection_id, source_text, embedding)
      VALUES ($1, $2, $3::vector)
    `, [connectionId, embeddingText.slice(0, 1000), toVectorLiteral(embedding)])
    console.log(`[Enrich-LC] Re-embedded | ${name} | ${embeddingText.length} chars`)
  } catch (err) {
    console.error(`[Enrich-LC] Re-embed error | ${name}:`, err.message)
  }

  console.log(`[Enrich-LC] Complete | ${name} | ${Date.now() - start}ms`)
  return { connectionId, status: 'enriched', summary: aiSummary }
}
