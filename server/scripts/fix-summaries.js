// One-off script to re-generate bad AI summaries using existing Apollo/Brave data
// Usage: node server/scripts/fix-summaries.js

import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '../../.env'), override: true })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const BAD_IDS = [3, 4, 19, 65, 112, 170]

const SYSTEM_PROMPT = `Write a professional summary paragraph about this person.

Include if available:
- Current role and company
- Career trajectory and notable past roles
- Public content they've created (blog posts, podcast appearances, talks, open-source contributions)
- Areas of expertise and what they're known for
- Recent professional activity or news

IMPORTANT RULES:
- Output ONLY the summary paragraph. No preamble, reasoning, labels, or commentary.
- Never start with "Based on the search results" or similar meta-commentary.
- The structured data (career history, title, company) is authoritative. Web mentions may reference other people with the same name — only include web mentions that clearly match the person's known role, company, or industry.
- Do not include LinkedIn connection counts or other social media metrics.
- If data is limited, write a shorter summary (2-3 sentences) with what you have. Do not pad with hedging language like "it is difficult to determine" or "without more information."
- 3-6 sentences. Be factual and direct.`

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function regenerateSummary(personId) {
  // Get person info
  const { rows: [person] } = await pool.query(
    'SELECT id, display_name, linkedin_url, current_title, current_company FROM people WHERE id = $1',
    [personId]
  )
  if (!person) { console.error(`Person ${personId} not found`); return }

  // Get employment history
  const { rows: jobs } = await pool.query(
    'SELECT title, organization, start_date, end_date, is_current FROM employment_history WHERE person_id = $1 ORDER BY start_date DESC NULLS FIRST',
    [personId]
  )

  // Get Brave snippets from raw_payload
  let braveSnippets = []
  const { rows: [braveRow] } = await pool.query(
    "SELECT raw_payload FROM person_enrichment WHERE person_id = $1 AND source = 'brave'",
    [personId]
  )
  if (braveRow?.raw_payload) {
    const payload = typeof braveRow.raw_payload === 'string' ? JSON.parse(braveRow.raw_payload) : braveRow.raw_payload
    const allResults = [...(payload.results1 || []), ...(payload.results2 || [])]
    const seen = new Set()
    for (const r of allResults) {
      if (seen.has(r.url)) continue
      seen.add(r.url)
      braveSnippets.push({ title: r.title || '', description: r.description || '' })
    }
  }

  // Build prompt (same format as enrich.js)
  let promptParts = [`Build a professional profile summary for: ${person.display_name}`]
  if (person.linkedin_url) promptParts.push(`LinkedIn: ${person.linkedin_url}`)
  if (person.current_title && person.current_company) {
    promptParts.push(`Current role: ${person.current_title} at ${person.current_company}`)
  } else if (person.current_company) {
    promptParts.push(`Current company: ${person.current_company}`)
  } else if (person.current_title) {
    promptParts.push(`Current title: ${person.current_title}`)
  }

  if (jobs.length > 0) {
    const historyStr = jobs
      .map(j => `- ${j.title || 'Unknown role'} at ${j.organization || 'Unknown'} (${j.start_date || '?'} – ${j.is_current ? 'Present' : j.end_date || '?'})`)
      .join('\n')
    promptParts.push(`\nCareer history:\n${historyStr}`)
  }

  if (braveSnippets.length > 0) {
    const snippetStr = braveSnippets
      .slice(0, 12)
      .map(s => `- ${s.title}: ${s.description}`)
      .join('\n')
    promptParts.push(`\nRecent web mentions:\n${snippetStr}`)
  }

  const userPrompt = promptParts.join('\n')

  console.log(`\n--- ${person.display_name} (id=${personId}) ---`)
  console.log(`Prompt length: ${userPrompt.length} chars, ${jobs.length} jobs, ${braveSnippets.length} web mentions`)

  // Call Claude
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  const data = await res.json()

  if (data.type === 'error') {
    console.error(`ERROR: ${data.error?.message}`)
    return
  }

  const newSummary = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  console.log(`NEW SUMMARY:\n${newSummary}`)

  // Update in DB
  await pool.query(`
    UPDATE person_enrichment
    SET ai_summary = $1, enriched_at = NOW()
    WHERE person_id = $2 AND source = 'claude'
  `, [newSummary, personId])

  console.log(`✓ Updated in database`)
}

async function main() {
  console.log(`Re-generating summaries for ${BAD_IDS.length} people...`)
  for (const id of BAD_IDS) {
    await regenerateSummary(id)
    await sleep(2000) // be nice to the API
  }
  console.log('\nDone!')
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
