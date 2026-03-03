import { query } from './db.js'
import { normalizeLinkedInUrl } from './linkedin.js'

const APOLLO_API_KEY = process.env.APOLLO_API_KEY || ''
const BRAVE_API_KEY = process.env.BRAVE_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── Name mismatch guard (the "Lee Mayer" case) ────────────────────────
// Apollo sometimes returns a different person for a LinkedIn URL.
// We require at least one name token overlap to accept the data.
function namesMatch(stored, returned) {
  if (!stored || !returned) return false
  const a = stored.toLowerCase().split(/\s+/)
  const b = returned.toLowerCase().split(/\s+/)
  return a.some(part => part.length > 1 && b.includes(part))
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
  await query('DELETE FROM employment_history WHERE person_id = $1', [personId])

  const history = person.employment_history || []
  for (const job of history) {
    await query(`
      INSERT INTO employment_history (person_id, organization, title, start_date, end_date, is_current)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      personId,
      job.organization_name || 'Unknown',
      job.title || null,
      job.start_date || null,
      job.end_date || null,
      job.current || false,
    ])
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
      console.log(`[Enrich] Apollo ${Date.now() - start}ms | ${person.display_name} | cached`)
      apolloData = cached.rows[0].raw_payload
      steps.apollo = 'cached'
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

    // Extract context for downstream steps
    if (apolloData?.person) {
      const ap = apolloData.person
      context.title = ap.title || null
      context.company = ap.organization?.name || null
      const pastJobs = (ap.employment_history || [])
        .filter(e => !e.current)
        .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
      context.notablePastCompany = pastJobs[0]?.organization_name || null
    }
  } catch (err) {
    console.error(`[Enrich] Apollo error | ${person.display_name}:`, err.message)
    steps.apollo = 'error'
  }

  // ── Step B: Brave Search ────────────────────────────────────────────
  try {
    const start = Date.now()

    // Query 1: professional news / activity
    const q1Parts = [`"${context.name}"`]
    if (context.company) q1Parts.push(context.company)
    else if (context.notablePastCompany) q1Parts.push(context.notablePastCompany)
    const braveQuery1 = q1Parts.join(' ')

    // Query 2: public content / thought leadership
    const q2Parts = [`"${context.name}"`, 'podcast interview blog speaker']
    if (context.company) q2Parts.push(context.company)
    const braveQuery2 = q2Parts.join(' ')

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

    const results1 = data1.web?.results || []
    const results2 = data2.web?.results || []
    const totalResults = results1.length + results2.length

    // Save combined results
    const payload = {
      query1: braveQuery1, query2: braveQuery2,
      results1, results2,
    }
    await query(`
      INSERT INTO person_enrichment (person_id, source, raw_payload, enriched_at)
      VALUES ($1, 'brave', $2, NOW())
      ON CONFLICT (person_id, source) DO UPDATE
      SET raw_payload = EXCLUDED.raw_payload, enriched_at = NOW()
    `, [personId, JSON.stringify(payload)])

    // Build snippets for Claude context
    const allResults = [...results1, ...results2]
    const seen = new Set()
    for (const r of allResults) {
      if (seen.has(r.url)) continue
      seen.add(r.url)
      context.braveSnippets.push({ title: r.title || '', description: r.description || '', url: r.url || '' })
    }

    steps.brave = 'ok'
    console.log(`[Enrich] Brave ${Date.now() - start}ms | ${person.display_name} | ${totalResults} results`)
  } catch (err) {
    console.error(`[Enrich] Brave error | ${person.display_name}:`, err.message)
    steps.brave = 'error'
  }

  // ── Step C: Claude with web search ──────────────────────────────────
  try {
    const start = Date.now()

    // Build prompt with accumulated context
    let promptParts = [`Build a professional profile summary for: ${context.name}`]
    if (context.linkedinUrl) promptParts.push(`LinkedIn: ${context.linkedinUrl}`)
    if (context.title && context.company) promptParts.push(`Current role: ${context.title} at ${context.company}`)
    else if (context.company) promptParts.push(`Current company: ${context.company}`)
    else if (context.title) promptParts.push(`Current title: ${context.title}`)
    if (context.notablePastCompany) promptParts.push(`Notable past company: ${context.notablePastCompany}`)

    // Add Brave snippets as additional context
    if (context.braveSnippets.length > 0) {
      const snippetStr = context.braveSnippets
        .slice(0, 8)
        .map(s => `- ${s.title}: ${s.description}`)
        .join('\n')
      promptParts.push(`\nRecent web mentions:\n${snippetStr}`)
    }

    const userPrompt = promptParts.join('\n')

    // Retry loop for rate limits (up to 3 attempts with exponential backoff)
    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)

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
            tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
            system: `You are a professional profile researcher. Synthesize a comprehensive professional summary paragraph about this person.

Include if available:
- Current role and company
- Career trajectory and notable past roles
- Public content they've created (blog posts, podcast appearances, talks, open-source contributions)
- Areas of expertise and what they're known for
- Recent professional activity or news

Return a single paragraph of 3-6 sentences. Be factual — only include verifiable information. If you can't find much, keep it brief and honest. Do not include any preamble or labels — just the summary paragraph.`,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        })

        const data = await claudeRes.json()

        // Rate limit? Back off and retry
        if (data.type === 'error' && data.error?.type === 'rate_limit_error') {
          const backoff = attempt * 20000 // 20s, 40s, 60s
          console.warn(`[Enrich] Claude rate limited (attempt ${attempt}/${MAX_RETRIES}) | ${person.display_name} | retrying in ${backoff/1000}s`)
          clearTimeout(timeout)
          if (attempt < MAX_RETRIES) {
            await sleep(backoff)
            continue
          }
          // Final attempt failed — save error and move on
          await query(`
            INSERT INTO person_enrichment (person_id, source, raw_payload, enriched_at)
            VALUES ($1, 'claude', $2, NOW())
            ON CONFLICT (person_id, source) DO UPDATE
            SET raw_payload = EXCLUDED.raw_payload, enriched_at = NOW()
          `, [personId, JSON.stringify(data)])
          steps.claude = 'rate_limited'
          break
        }

        const aiSummary = (data.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')

        await query(`
          INSERT INTO person_enrichment (person_id, source, raw_payload, ai_summary, enriched_at)
          VALUES ($1, 'claude', $2, $3, NOW())
          ON CONFLICT (person_id, source) DO UPDATE
          SET raw_payload = EXCLUDED.raw_payload, ai_summary = EXCLUDED.ai_summary, enriched_at = NOW()
        `, [personId, JSON.stringify(data), aiSummary || null])

        steps.claude = aiSummary ? 'ok' : 'empty'
        console.log(`[Enrich] Claude ${Date.now() - start}ms | ${person.display_name} | ${(aiSummary || '').length} chars`)
        break // Success — exit retry loop
      } finally {
        clearTimeout(timeout)
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[Enrich] Claude timed out after 45s | ${person.display_name}`)
    } else {
      console.error(`[Enrich] Claude error | ${person.display_name}:`, err.message)
    }
    steps.claude = 'error'
  }

  // ── Finalize ────────────────────────────────────────────────────────
  await query('UPDATE people SET enriched_at = NOW() WHERE id = $1', [personId])

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
