/**
 * Full enrichment pipeline: Brave re-enrichment → Content extraction → Expertise re-extraction
 * Usage: node server/run-full-pipeline.js [--brave] [--content] [--expertise] [--all]
 *   --brave     Re-run Brave search with fingerprint queries
 *   --content   Run content extraction from discovered URLs
 *   --expertise Re-run expertise extraction with all data
 *   --all       Run all three steps (default if no flags)
 *
 * Runs against LOCAL database. Set env vars as needed.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '../.env', override: true })

import { query } from './lib/db.js'

const args = process.argv.slice(2)
const runAll = args.includes('--all') || args.length === 0
const runBrave = runAll || args.includes('--brave')
const runContent = runAll || args.includes('--content')
const runExpertise = runAll || args.includes('--expertise')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── Step 1: Brave re-enrichment ──────────────────────────────────────
if (runBrave) {
  console.log('\n' + '='.repeat(70))
  console.log('STEP 1: Brave re-enrichment with fingerprint queries')
  console.log('='.repeat(70) + '\n')

  // Dynamic import to avoid loading enrich.js at module level
  const { enrichBraveBatch } = await import('./lib/enrich.js')

  // Get all people who have been enriched
  const res = await query(`
    SELECT DISTINCT pe.person_id, p.display_name
    FROM person_enrichment pe
    JOIN people p ON p.id = pe.person_id
    WHERE pe.source = 'apollo' AND pe.raw_payload IS NOT NULL
    ORDER BY pe.person_id
  `)
  const personIds = res.rows.map(r => r.person_id)
  console.log(`Found ${personIds.length} people with Apollo data to re-enrich via Brave\n`)

  // Check if enrichBraveBatch exists, otherwise do it manually
  if (typeof enrichBraveBatch === 'function') {
    await enrichBraveBatch(personIds)
  } else {
    // Manual brave-only enrichment
    const { enrichPerson } = await import('./lib/enrich.js')
    let success = 0, failed = 0
    for (let i = 0; i < personIds.length; i++) {
      const pid = personIds[i]
      const name = res.rows[i].display_name
      console.log(`[Brave ${i + 1}/${personIds.length}] ${name} (id=${pid})`)
      try {
        // We need a brave-only enrichment — enrichPerson runs all 3 steps
        // For now, just use the full enrichPerson but it will skip Apollo (cached)
        // and Claude (cached), only re-running Brave
        await enrichPerson(pid)
        success++
      } catch (err) {
        console.error(`  ERROR: ${err.message}`)
        failed++
      }
      if (i < personIds.length - 1) await sleep(3000)
    }
    console.log(`\nBrave enrichment complete: ${success} success, ${failed} failed`)
  }
}

// ── Step 2: Content extraction ───────────────────────────────────────
if (runContent) {
  console.log('\n' + '='.repeat(70))
  console.log('STEP 2: Content extraction from discovered URLs')
  console.log('='.repeat(70) + '\n')

  const { extractContentBatch } = await import('./lib/contentExtract.js')
  const results = await extractContentBatch([], { force: true, delayMs: 2000 })
  console.log('Content extraction results:', results)
}

// ── Step 3: Expertise re-extraction ──────────────────────────────────
if (runExpertise) {
  console.log('\n' + '='.repeat(70))
  console.log('STEP 3: Expertise re-extraction with enriched data')
  console.log('='.repeat(70) + '\n')

  const { extractExpertiseBatch } = await import('./lib/expertise.js')
  const results = await extractExpertiseBatch([], { force: true, delayMs: 2000 })
  console.log('Expertise extraction results:', results)
}

console.log('\n✓ Pipeline complete\n')
process.exit(0)
