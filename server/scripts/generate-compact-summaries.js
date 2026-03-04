// Generate claude-compact micro-summaries for Network Brain context
// Reads full AI summaries and compresses to 1-2 sentence essentials
// Stores as source='claude-compact' in person_enrichment
// Usage: node server/scripts/generate-compact-summaries.js

import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '../../.env'), override: true })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const SYSTEM_PROMPT = `You are compressing professional summaries into compact one-liners for a search/matching system.

For each person, output a single line in this format:
ID: [compressed summary]

The compressed summary should be 1-2 sentences (max 40 words) capturing ONLY:
- Current role + company
- 1-2 most notable career highlights or expertise areas
- Industry/domain if not obvious from role

Drop: education details, LinkedIn metrics, career start dates, generic descriptors ("experienced professional"), company descriptions.

Example input:
"Sarah Chen is currently VP of Engineering at Stripe, having previously led platform teams at Google for 8 years. She holds a PhD in distributed systems from MIT and has spoken at KubeCon about microservices architecture. Her earlier career included time at Amazon Web Services."

Example output:
VP Engineering at Stripe. Previously led platform teams at Google for 8 years; expert in distributed systems and microservices.`

async function main() {
  // Get all full summaries
  const { rows } = await pool.query(`
    SELECT pe.person_id as id, p.display_name, pe.ai_summary
    FROM person_enrichment pe
    JOIN people p ON p.id = pe.person_id
    WHERE pe.source = 'claude' AND pe.ai_summary IS NOT NULL
    ORDER BY pe.person_id
  `)

  console.log(`Found ${rows.length} summaries to compress`)

  // Process in batches of 15 to reduce API calls
  const BATCH_SIZE = 15
  const batches = []
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE))
  }

  console.log(`Processing in ${batches.length} batches of up to ${BATCH_SIZE}...`)

  let totalSaved = 0

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]
    console.log(`\nBatch ${batchIdx + 1}/${batches.length} (${batch.length} people)...`)

    // Build the user prompt with all summaries in this batch
    const userPrompt = batch.map(row =>
      `[${row.id}] ${row.display_name}:\n${row.ai_summary}`
    ).join('\n\n---\n\n')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Compress each of these ${batch.length} professional summaries into a compact one-liner:\n\n${userPrompt}` }],
      }),
    })

    const data = await res.json()

    if (data.type === 'error') {
      console.error(`API ERROR: ${data.error?.message}`)
      await sleep(5000)
      continue
    }

    const responseText = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    // Parse the response - handle various formats Claude might use
    // e.g. "1: summary", "**1:** summary", "[1] Name: summary", "[1] summary"
    const lines = responseText.split('\n').filter(l => l.trim())
    const parsed = new Map()

    // Build a name lookup to strip names from lines
    const nameById = new Map(batch.map(r => [r.id, r.display_name]))

    for (const line of lines) {
      // Strip markdown bold markers
      let cleaned = line.replace(/\*\*/g, '').trim()
      // Match [ID] or ID: or ID. or ID) at the start
      const idMatch = cleaned.match(/^\[?(\d+)\]?[:.)\s]\s*(.+)$/)
      if (idMatch) {
        const id = parseInt(idMatch[1])
        let text = idMatch[2].trim()
        // If the text starts with the person's name + colon, strip it
        const name = nameById.get(id)
        if (name && text.startsWith(name + ':')) {
          text = text.slice(name.length + 1).trim()
        } else if (name) {
          // Try case-insensitive or partial name match at start
          const namePattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i')
          text = text.replace(namePattern, '')
        }
        parsed.set(id, text)
      }
    }

    // Debug: if parsing failed, log first few lines of raw response
    if (parsed.size === 0 && lines.length > 0) {
      console.log(`  DEBUG raw first 3 lines:`)
      lines.slice(0, 3).forEach(l => console.log(`    "${l}"`))
    }

    console.log(`  Parsed ${parsed.size}/${batch.length} compact summaries`)

    // Save to DB
    for (const row of batch) {
      const compact = parsed.get(row.id)
      if (!compact) {
        console.warn(`  ⚠ Missing compact summary for ${row.display_name} (id=${row.id})`)
        continue
      }

      await pool.query(`
        INSERT INTO person_enrichment (person_id, source, raw_payload, ai_summary, enriched_at)
        VALUES ($1, 'claude-compact', '{}', $2, NOW())
        ON CONFLICT (person_id, source) DO UPDATE
        SET ai_summary = EXCLUDED.ai_summary, enriched_at = NOW()
      `, [row.id, compact])

      totalSaved++
    }

    // Log a few examples from this batch
    const examples = batch.slice(0, 3)
    for (const ex of examples) {
      const compact = parsed.get(ex.id)
      if (compact) {
        console.log(`  ${ex.display_name}: ${compact}`)
      }
    }

    // Usage stats
    const inputTokens = data.usage?.input_tokens || 0
    const outputTokens = data.usage?.output_tokens || 0
    console.log(`  Tokens: ${inputTokens} in / ${outputTokens} out`)

    if (batchIdx < batches.length - 1) {
      await sleep(2000)
    }
  }

  console.log(`\n✓ Done! Saved ${totalSaved} compact summaries`)

  // Quick stats
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*) as total,
      AVG(LENGTH(ai_summary)) as avg_len,
      MAX(LENGTH(ai_summary)) as max_len
    FROM person_enrichment
    WHERE source = 'claude-compact'
  `)
  console.log(`  Avg length: ${Math.round(stats.avg_len)} chars, Max: ${stats.max_len} chars`)

  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
