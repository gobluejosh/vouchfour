import { query } from './db.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── Expertise Extraction Pipeline ──────────────────────────────────
// Takes a person's enrichment data (employment history, AI summary, Brave
// search results) and uses Claude to extract structured expertise chunks.
// These chunks power semantic search for Brain v2.

const EXTRACTION_SYSTEM_PROMPT = `You are analyzing a professional's career data to extract structured expertise signals. Your job is to identify what this person could uniquely help someone with — not just their title, but what they've *navigated*, *built*, and *learned*.

Output a JSON array of expertise chunks. Each chunk has:
- "type": one of "trajectory_summary", "transition", "scaling", "topic", "functional", "environment"
- "text": a 1-3 sentence description written as if describing this person to someone who might need their help. Be specific — include company names, timeframes, and concrete details.
- "tags": array of lowercase keyword tags for matching (e.g., "zero-to-one", "series-b", "ic-to-manager", "edtech", "marketplace")

CHUNK TYPES:

**trajectory_summary** (exactly 1): A 2-3 sentence narrative of this person's career arc, emphasizing what makes their experience distinctive. Write it as: "Person who has [done X], [navigated Y], and [brings Z perspective]." This is the primary matching text.

**transition** (0-4): Specific career transitions that represent navigable moments others might face. Examples:
- IC to manager/director/VP
- Big company to startup (or reverse)
- Function switch (engineer → product, sales → CS)
- Founder to operator (or reverse)
- Industry pivot
- Layoff/company shutdown → recovery
- Individual role to executive/board
Focus on transitions that are *meaningful* — a lateral move at the same company isn't interesting. Include the companies and approximate timeframe.

**scaling** (0-3): Moments where this person was present during significant growth, change, or challenge. Examples:
- Built a team from 0 to N
- Was at a company through acquisition/IPO/major funding
- Scaled a function or product through a growth phase
- Navigated a company through crisis/pivot/restructuring
Include concrete details: company name, what changed, their role in it.

**topic** (0-4): Specific topic expertise evidenced by content creation (blog posts, podcasts, talks, published work) OR deep repeated experience. Only include if there's real evidence — don't infer topics just from job titles. The web mentions data is key here.

**functional** (0-2): Depth of experience in a specific professional function. Only include if they have 5+ years or notable depth. Include breadth across sub-areas if relevant.

**environment** (0-2): Types of professional environments they know deeply. Examples: early-stage startups, enterprise/Fortune 500, specific industries (edtech, fintech, healthcare), geographic markets, remote/distributed teams.

RULES:
- Be SPECIFIC. "Experienced leader" is useless. "Built and led engineering team from 3 to 40 at a Series B edtech startup over 4 years" is excellent.
- Each chunk must be useful for MATCHING against someone's challenge. Ask: "Would this chunk help identify this person as relevant to someone struggling with [X]?"
- Use the web mentions to find topics — blog posts, podcast appearances, conference talks are strong signals. But only include web mentions that clearly match this person (same name + matching company/role).
- If the career data is thin, produce fewer chunks. Don't pad.
- Tags should be specific enough to be useful but general enough to match. "edtech" yes, "magicschool-ai" no. "zero-to-one" yes, "hired-sarah" no.
- Output ONLY valid JSON array. No markdown, no commentary.`

/**
 * Gather all available data for a person to feed into expertise extraction.
 */
async function gatherPersonData(personId) {
  const [personRes, historyRes, summaryRes, braveRes, apolloRes, vouchRes, contentRes] = await Promise.all([
    query(`SELECT id, display_name, current_title, current_company, location, industry, headline
           FROM people WHERE id = $1`, [personId]),
    query(`SELECT organization, title, start_date, end_date, is_current, location, description
           FROM employment_history WHERE person_id = $1
           ORDER BY start_date DESC NULLS LAST`, [personId]),
    query(`SELECT ai_summary FROM person_enrichment
           WHERE person_id = $1 AND source = 'claude' AND ai_summary IS NOT NULL`, [personId]),
    query(`SELECT raw_payload FROM person_enrichment
           WHERE person_id = $1 AND source = 'brave'`, [personId]),
    // Apollo raw data — org details (employee count, funding, stage, revenue)
    query(`SELECT raw_payload FROM person_enrichment
           WHERE person_id = $1 AND source = 'apollo'`, [personId]),
    // Vouch context: who vouched for this person and in what function
    query(`SELECT jf.name as function_name, p.display_name as voucher_name, p.current_company as voucher_company
           FROM vouches v
           JOIN job_functions jf ON jf.id = v.job_function_id
           JOIN people p ON p.id = v.voucher_id
           WHERE v.vouchee_id = $1`, [personId]),
    // Discovered content (blog posts, podcasts, GitHub repos, talks, etc.)
    query(`SELECT content_type, source_platform, title, content_summary, topics
           FROM person_content WHERE person_id = $1
           ORDER BY content_type, id`, [personId]),
  ])

  const person = personRes.rows[0]
  if (!person) return null

  const history = historyRes.rows
  const summary = summaryRes.rows[0]?.ai_summary || ''

  // Extract Apollo org data (company size, funding, stage, etc.)
  let apolloOrg = null
  let apolloSeniority = null
  let apolloDepartments = null
  if (apolloRes.rows[0]?.raw_payload) {
    const apolloData = typeof apolloRes.rows[0].raw_payload === 'string'
      ? JSON.parse(apolloRes.rows[0].raw_payload)
      : apolloRes.rows[0].raw_payload
    const p = apolloData.person || apolloData
    apolloSeniority = p.seniority || null
    apolloDepartments = p.departments || null
    if (p.organization) {
      const org = p.organization
      apolloOrg = {
        name: org.name,
        employees: org.estimated_num_employees,
        totalFunding: org.total_funding_printed,
        annualRevenue: org.annual_revenue_printed,
        fundingStage: org.latest_funding_stage,
        foundedYear: org.founded_year,
        industry: org.industry,
        description: org.short_description,
      }
    }
  }

  // Parse Brave results into clean snippets
  let braveSnippets = []
  if (braveRes.rows[0]?.raw_payload) {
    const payload = typeof braveRes.rows[0].raw_payload === 'string'
      ? JSON.parse(braveRes.rows[0].raw_payload)
      : braveRes.rows[0].raw_payload
    const allResults = [...(payload.results1 || []), ...(payload.results2 || []), ...(payload.results3 || [])]
    const seen = new Set()
    for (const r of allResults) {
      if (!r.url || seen.has(r.url)) continue
      // Skip LinkedIn profiles — not useful for topic extraction
      if (r.url.includes('linkedin.com')) continue
      seen.add(r.url)
      braveSnippets.push({ title: r.title || '', description: r.description || '', url: r.url })
    }
  }

  const vouches = vouchRes.rows
  const content = contentRes.rows

  return { person, history, summary, braveSnippets, apolloOrg, apolloSeniority, apolloDepartments, vouches, content }
}

/**
 * Build the user prompt for Claude from gathered data.
 */
function buildExtractionPrompt(data) {
  const { person, history, summary, braveSnippets, apolloOrg, apolloSeniority, apolloDepartments, vouches, content } = data
  const parts = []

  parts.push(`Person: ${person.display_name}`)
  if (person.current_title && person.current_company) {
    parts.push(`Current: ${person.current_title} at ${person.current_company}`)
  }
  if (apolloSeniority) parts.push(`Seniority: ${apolloSeniority}`)
  if (person.industry) parts.push(`Industry: ${person.industry}`)
  if (person.location) parts.push(`Location: ${person.location}`)

  // Include Apollo org data for current company — employee count, funding, stage
  if (apolloOrg) {
    const orgParts = []
    if (apolloOrg.employees) orgParts.push(`~${apolloOrg.employees} employees`)
    if (apolloOrg.totalFunding) orgParts.push(`$${apolloOrg.totalFunding} total funding`)
    if (apolloOrg.annualRevenue) orgParts.push(`$${apolloOrg.annualRevenue} annual revenue`)
    if (apolloOrg.fundingStage) orgParts.push(`stage: ${apolloOrg.fundingStage}`)
    if (apolloOrg.foundedYear) orgParts.push(`founded ${apolloOrg.foundedYear}`)
    if (orgParts.length > 0) {
      parts.push(`Current company details: ${apolloOrg.name} — ${orgParts.join(', ')}`)
    }
    if (apolloOrg.description) {
      parts.push(`Company description: ${apolloOrg.description.slice(0, 300)}`)
    }
  }

  if (summary) {
    parts.push(`\nAI Summary:\n${summary}`)
  }

  if (history.length > 0) {
    const historyStr = history.map(j => {
      const dateRange = `${j.start_date ? new Date(j.start_date).getFullYear() : '?'} – ${j.is_current ? 'Present' : (j.end_date ? new Date(j.end_date).getFullYear() : '?')}`
      const loc = j.location ? ` (${j.location})` : ''
      const desc = j.description ? ` — ${j.description}` : ''
      return `- ${j.title || 'Role'} at ${j.organization || 'Unknown'} | ${dateRange}${loc}${desc}`
    }).join('\n')
    parts.push(`\nEmployment History (${history.length} roles):\n${historyStr}`)
  }

  if (braveSnippets.length > 0) {
    const snippetStr = braveSnippets.slice(0, 15).map(s =>
      `- ${s.title}: ${s.description}`
    ).join('\n')
    parts.push(`\nWeb Mentions (${braveSnippets.length} results, showing top 15):\n${snippetStr}`)
  }

  if (vouches.length > 0) {
    const vouchStr = vouches.map(v =>
      `- Vouched for in ${v.function_name} by ${v.voucher_name}${v.voucher_company ? ` (${v.voucher_company})` : ''}`
    ).join('\n')
    parts.push(`\nVouch Context:\n${vouchStr}`)
  }

  // Include discovered content (blog posts, podcasts, GitHub repos, talks)
  if (content && content.length > 0) {
    const contentStr = content.map(c => {
      const topics = c.topics?.length > 0 ? ` [topics: ${c.topics.join(', ')}]` : ''
      const summary = c.content_summary ? ` — ${c.content_summary}` : ''
      return `- [${c.content_type}] ${c.title}${summary}${topics}`
    }).join('\n')
    parts.push(`\nDiscovered Content (${content.length} items — blog posts, podcasts, talks, GitHub repos):\n${contentStr}`)
  }

  return parts.join('\n')
}

/**
 * Extract expertise chunks for a single person.
 * Returns the parsed chunks array, or null on failure.
 */
export async function extractExpertise(personId, { verbose = false } = {}) {
  const start = Date.now()

  // Gather all data
  const data = await gatherPersonData(personId)
  if (!data) {
    console.warn(`[Expertise] Person ${personId} not found`)
    return null
  }

  if (!data.summary && data.history.length === 0) {
    console.warn(`[Expertise] Person ${personId} (${data.person.display_name}) has no data to extract from`)
    return null
  }

  const userPrompt = buildExtractionPrompt(data)
  if (verbose) console.log(`[Expertise] Prompt for ${data.person.display_name}:\n${userPrompt}\n---`)

  // Call Claude
  const MAX_RETRIES = 3
  let chunks = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45000)

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
          max_tokens: 2048,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })

      const result = await claudeRes.json()
      clearTimeout(timeout)

      // Rate limited — backoff and retry
      if (result.type === 'error' && result.error?.type === 'rate_limit_error') {
        const backoff = attempt * 15000
        console.warn(`[Expertise] Rate limited (attempt ${attempt}/${MAX_RETRIES}) | ${data.person.display_name} | retrying in ${backoff / 1000}s`)
        if (attempt < MAX_RETRIES) {
          await sleep(backoff)
          continue
        }
        return null
      }

      const text = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

      // Parse JSON — handle potential markdown fencing
      let cleaned = text.trim()
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }

      try {
        chunks = JSON.parse(cleaned)
      } catch (parseErr) {
        console.error(`[Expertise] JSON parse failed for ${data.person.display_name}:`, parseErr.message)
        if (verbose) console.error(`[Expertise] Raw output:\n${text}`)
        return null
      }

      if (!Array.isArray(chunks)) {
        console.error(`[Expertise] Expected array, got ${typeof chunks} for ${data.person.display_name}`)
        return null
      }

      break // Success
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn(`[Expertise] Timed out (attempt ${attempt}) | ${data.person.display_name}`)
      } else {
        console.error(`[Expertise] Error (attempt ${attempt}) | ${data.person.display_name}:`, err.message)
      }
      if (attempt === MAX_RETRIES) return null
      await sleep(attempt * 5000)
    }
  }

  if (!chunks || chunks.length === 0) return null

  // Validate and filter chunks
  const VALID_TYPES = new Set(['trajectory_summary', 'transition', 'scaling', 'topic', 'functional', 'environment'])
  const validChunks = chunks.filter(c => {
    if (!c.type || !c.text) return false
    if (!VALID_TYPES.has(c.type)) {
      console.warn(`[Expertise] Skipping invalid chunk type "${c.type}" for ${data.person.display_name}`)
      return false
    }
    return true
  })

  // Save to DB — delete old non-bio chunks first, then insert new ones
  // Bio chunks (from /bio interview) are managed separately and must be preserved
  await query(`DELETE FROM person_expertise WHERE person_id = $1 AND chunk_type != 'bio'`, [personId])

  for (const chunk of validChunks) {
    const tags = Array.isArray(chunk.tags) ? chunk.tags : []
    const metadata = chunk.metadata || {}
    await query(`
      INSERT INTO person_expertise (person_id, chunk_type, chunk_text, tags, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [personId, chunk.type, chunk.text, tags, JSON.stringify(metadata)])
  }

  const elapsed = Date.now() - start
  console.log(`[Expertise] ${data.person.display_name} | ${validChunks.length} chunks | ${elapsed}ms`)

  return validChunks
}

/**
 * Run expertise extraction in batch.
 * @param {number[]} personIds - specific IDs, or empty to process all enriched people
 * @param {object} options
 * @param {number} options.delayMs - delay between people (default 2000ms)
 * @param {boolean} options.force - re-extract even if chunks already exist
 * @param {boolean} options.verbose - log prompts and raw output
 */
export async function extractExpertiseBatch(personIds, { delayMs = 2000, force = false, verbose = false } = {}) {
  // If no IDs specified, get all people with enrichment data
  if (!personIds || personIds.length === 0) {
    const res = await query(`
      SELECT DISTINCT pe.person_id
      FROM person_enrichment pe
      WHERE pe.source = 'claude' AND pe.ai_summary IS NOT NULL
      ORDER BY pe.person_id
    `)
    personIds = res.rows.map(r => r.person_id)
  }

  // Unless forced, skip people who already have chunks
  if (!force) {
    const existingRes = await query(`
      SELECT DISTINCT person_id FROM person_expertise WHERE person_id = ANY($1)
    `, [personIds])
    const existing = new Set(existingRes.rows.map(r => r.person_id))
    const before = personIds.length
    personIds = personIds.filter(id => !existing.has(id))
    if (before !== personIds.length) {
      console.log(`[Expertise] Skipping ${before - personIds.length} people with existing chunks (use force=true to re-extract)`)
    }
  }

  console.log(`[Expertise] Starting batch extraction for ${personIds.length} people`)
  const results = { success: 0, skipped: 0, failed: 0 }

  for (let i = 0; i < personIds.length; i++) {
    const personId = personIds[i]
    console.log(`[Expertise] Processing ${i + 1}/${personIds.length} (person_id=${personId})`)

    try {
      const chunks = await extractExpertise(personId, { verbose })
      if (chunks) {
        results.success++
      } else {
        results.skipped++
      }
    } catch (err) {
      console.error(`[Expertise] Failed for person_id=${personId}:`, err.message)
      results.failed++
    }

    // Delay between people to avoid rate limits
    if (i < personIds.length - 1) {
      await sleep(delayMs)
    }
  }

  console.log(`[Expertise] Batch complete: ${results.success} success, ${results.skipped} skipped, ${results.failed} failed`)
  return results
}
