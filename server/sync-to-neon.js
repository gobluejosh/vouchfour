/**
 * Sync local pipeline data to Neon production DB.
 * Copies: person_enrichment, person_expertise, person_content, person_embeddings
 *
 * Usage: node server/sync-to-neon.js
 *
 * Reads from local DB (DATABASE_URL in .env) and writes to Neon (NEON_DATABASE_URL).
 * Set NEON_DATABASE_URL in .env or pass as env var.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '../.env', override: true })

import pg from 'pg'
const { Pool } = pg

const LOCAL_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/vouchfour'
const NEON_URL = process.env.NEON_DATABASE_URL

if (!NEON_URL) {
  console.error('Set NEON_DATABASE_URL in .env or as env var')
  console.error('Example: NEON_DATABASE_URL=postgresql://neondb_owner:PASSWORD@HOST/neondb?sslmode=require')
  process.exit(1)
}

const local = new Pool({ connectionString: LOCAL_URL })
const neon = new Pool({ connectionString: NEON_URL })

async function syncTable(tableName, columns, { truncateFirst = true, batchSize = 100 } = {}) {
  const start = Date.now()
  console.log(`\n── Syncing ${tableName} ──`)

  // Count local rows
  const localCount = await local.query(`SELECT COUNT(*) FROM ${tableName}`)
  console.log(`  Local: ${localCount.rows[0].count} rows`)

  // Truncate on Neon
  if (truncateFirst) {
    await neon.query(`DELETE FROM ${tableName}`)
    console.log(`  Neon: cleared`)
  }

  // Fetch all from local
  const colList = columns.join(', ')
  const res = await local.query(`SELECT ${colList} FROM ${tableName}`)
  const rows = res.rows

  if (rows.length === 0) {
    console.log(`  Nothing to sync`)
    return
  }

  // Insert in batches
  let inserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const placeholders = []
    const values = []
    let paramIdx = 1

    for (const row of batch) {
      const rowPlaceholders = []
      for (const col of columns) {
        let val = row[col]
        // Handle vector type — pgvector needs string literal
        if (col === 'embedding' && Array.isArray(val)) {
          val = '[' + val.join(',') + ']'
        }
        values.push(val)
        rowPlaceholders.push(`$${paramIdx++}`)
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`)
    }

    // For embedding column, cast to vector
    const castColList = columns.map(c =>
      c === 'embedding' ? `${c}` : c
    ).join(', ')

    await neon.query(`
      INSERT INTO ${tableName} (${castColList})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT DO NOTHING
    `, values)

    inserted += batch.length
  }

  const elapsed = Date.now() - start
  console.log(`  Synced: ${inserted} rows in ${elapsed}ms`)
}

try {
  // Test connections
  console.log('Testing connections...')
  const localTest = await local.query('SELECT COUNT(*) FROM people')
  console.log(`Local DB: ${localTest.rows[0].count} people`)
  await neon.query('SET search_path TO public')
  const neonTest = await neon.query('SELECT COUNT(*) FROM people')
  console.log(`Neon DB: ${neonTest.rows[0].count} people`)

  // Sync person_enrichment (all sources — includes fresh Brave + Claude data)
  await syncTable('person_enrichment', [
    'person_id', 'source', 'raw_payload', 'ai_summary', 'enriched_at',
  ])

  // Sync person_expertise
  await syncTable('person_expertise', [
    'id', 'person_id', 'chunk_type', 'chunk_text', 'tags', 'confidence', 'created_at',
  ])

  // Sync person_content
  await syncTable('person_content', [
    'id', 'person_id', 'content_type', 'source_url', 'source_platform',
    'discovered_via', 'title', 'content_summary', 'topics', 'raw_metadata',
    'content_hash', 'created_at', 'updated_at',
  ])

  // Sync person_embeddings (vector data)
  await syncTable('person_embeddings', [
    'id', 'person_id', 'expertise_id', 'content_id', 'source_type',
    'source_text', 'embedding', 'created_at',
  ])

  // Update sequences to match
  for (const table of ['person_expertise', 'person_content', 'person_embeddings']) {
    await neon.query(`SELECT setval('${table}_id_seq', (SELECT COALESCE(MAX(id), 0) FROM ${table}))`)
  }

  // Also sync updated people fields (enriched_at, review_status, etc.)
  const peopleRes = await local.query(`
    SELECT id, enriched_at, review_status, review_notes, reviewed_at
    FROM people WHERE enriched_at IS NOT NULL
  `)
  let peopleUpdated = 0
  for (const row of peopleRes.rows) {
    await neon.query(`
      UPDATE people SET enriched_at = $1, review_status = $2, review_notes = $3, reviewed_at = $4
      WHERE id = $5
    `, [row.enriched_at, row.review_status, row.review_notes, row.reviewed_at, row.id])
    peopleUpdated++
  }
  console.log(`\n── Updated ${peopleUpdated} people (enriched_at, review_status) ──`)

  // Final counts on Neon
  console.log('\n── Neon final counts ──')
  for (const table of ['person_enrichment', 'person_expertise', 'person_content', 'person_embeddings']) {
    const r = await neon.query(`SELECT COUNT(*) FROM ${table}`)
    console.log(`  ${table}: ${r.rows[0].count}`)
  }

  console.log('\n✓ Sync complete')
} catch (err) {
  console.error('Sync error:', err)
} finally {
  await local.end()
  await neon.end()
  process.exit(0)
}
