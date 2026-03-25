import { query } from './db.js'

const getOpenAIKey = () => process.env.OPENAI_API_KEY
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a JS number array to pgvector string format: [0.1,0.2,...]
 */
export function toVectorLiteral(arr) {
  return '[' + arr.join(',') + ']'
}


// ── OpenAI Embedding API ────────────────────────────────────────────

/**
 * Get embeddings for an array of texts from OpenAI.
 * Batches up to 100 texts per call.
 * @param {string[]} texts
 * @returns {number[][]} Array of embedding vectors
 */
export async function getEmbeddings(texts) {
  if (texts.length === 0) return []

  const apiKey = getOpenAIKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const allEmbeddings = []
  const batchSize = 100

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(`OpenAI embedding error: ${err.error?.message || res.statusText}`)
    }

    const data = await res.json()
    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index)
    allEmbeddings.push(...sorted.map(d => d.embedding))

    if (i + batchSize < texts.length) {
      await sleep(200) // Rate limit courtesy
    }
  }

  return allEmbeddings
}


// ── Embedding Pipeline ──────────────────────────────────────────────

/**
 * Embed all expertise chunks and content items for a person.
 * Skips items that already have embeddings unless force=true.
 */
export async function embedPerson(personId, { force = false } = {}) {
  const start = Date.now()

  // Get person info
  const personRes = await query('SELECT display_name FROM people WHERE id = $1', [personId])
  if (!personRes.rows[0]) {
    console.warn(`[Embed] Person ${personId} not found`)
    return { embedded: 0 }
  }
  const name = personRes.rows[0].display_name

  // Clear existing embeddings if force
  if (force) {
    await query('DELETE FROM person_embeddings WHERE person_id = $1', [personId])
  }

  // Get expertise chunks that need embedding
  const expertiseRes = await query(`
    SELECT pe.id, pe.chunk_type, pe.chunk_text, pe.tags
    FROM person_expertise pe
    LEFT JOIN person_embeddings emb ON emb.expertise_id = pe.id
    WHERE pe.person_id = $1 ${force ? '' : 'AND emb.id IS NULL'}
    ORDER BY pe.id
  `, [personId])

  // Get content items that need embedding
  const contentRes = await query(`
    SELECT pc.id, pc.content_type, pc.title, pc.content_summary, pc.topics
    FROM person_content pc
    LEFT JOIN person_embeddings emb ON emb.content_id = pc.id
    WHERE pc.person_id = $1 ${force ? '' : 'AND emb.id IS NULL'}
    ORDER BY pc.id
  `, [personId])

  // Build texts to embed
  const items = []

  for (const chunk of expertiseRes.rows) {
    // For expertise chunks, embed the text + tags for richer matching
    const tags = chunk.tags?.length > 0 ? ` [${chunk.tags.join(', ')}]` : ''
    const text = `${chunk.chunk_text}${tags}`
    items.push({
      sourceType: 'expertise',
      expertiseId: chunk.id,
      contentId: null,
      text,
    })
  }

  for (const content of contentRes.rows) {
    // For content items, embed title + summary + topics
    const parts = []
    if (content.title) parts.push(content.title)
    if (content.content_summary) parts.push(content.content_summary)
    if (content.topics?.length > 0) parts.push(`Topics: ${content.topics.join(', ')}`)
    const text = parts.join('. ')
    if (text.length > 10) { // Skip empty/trivial content
      items.push({
        sourceType: 'content',
        expertiseId: null,
        contentId: content.id,
        text,
      })
    }
  }

  if (items.length === 0) {
    console.log(`[Embed] ${name} | nothing to embed`)
    return { embedded: 0 }
  }

  // Get embeddings from OpenAI
  const texts = items.map(i => i.text)
  const embeddings = await getEmbeddings(texts)

  // Save to DB — pgvector expects vector as string literal '[0.1,0.2,...]'
  let saved = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const embedding = embeddings[i]

    try {
      await query(`
        INSERT INTO person_embeddings (person_id, expertise_id, content_id, source_type, source_text, embedding)
        VALUES ($1, $2, $3, $4, $5, $6::vector)
        ON CONFLICT DO NOTHING
      `, [
        personId,
        item.expertiseId,
        item.contentId,
        item.sourceType,
        item.text.slice(0, 1000), // Truncate for storage
        toVectorLiteral(embedding),
      ])
      saved++
    } catch (err) {
      console.error(`[Embed] DB error for ${name}: ${err.message}`)
    }
  }

  const elapsed = Date.now() - start
  console.log(`[Embed] ${name} | ${saved} embeddings (${expertiseRes.rows.length} expertise + ${contentRes.rows.length} content) | ${elapsed}ms`)
  return { embedded: saved }
}

/**
 * Embed all people in batch.
 */
export async function embedBatch(personIds, { force = false, delayMs = 500 } = {}) {
  if (!personIds || personIds.length === 0) {
    // Get all people with expertise chunks
    const res = await query(`
      SELECT DISTINCT person_id FROM person_expertise ORDER BY person_id
    `)
    personIds = res.rows.map(r => r.person_id)
  }

  console.log(`[Embed] Starting batch for ${personIds.length} people`)
  const results = { success: 0, skipped: 0, failed: 0 }

  for (let i = 0; i < personIds.length; i++) {
    try {
      const { embedded } = await embedPerson(personIds[i], { force })
      if (embedded > 0) results.success++
      else results.skipped++
    } catch (err) {
      console.error(`[Embed] Failed for person_id=${personIds[i]}: ${err.message}`)
      results.failed++
    }

    if (i < personIds.length - 1 && delayMs > 0) {
      await sleep(delayMs)
    }
  }

  console.log(`[Embed] Batch complete: ${results.success} success, ${results.skipped} skipped, ${results.failed} failed`)
  return results
}


// ── Semantic Search (pgvector native) ───────────────────────────────

/**
 * Semantic search: find the most relevant people for a query.
 * Uses pgvector's HNSW index with cosine distance operator (<=>).
 *
 * The <=> operator returns cosine DISTANCE (1 - similarity),
 * so similarity = 1 - distance.
 *
 * @param {string} queryText - The user's question/challenge
 * @param {object} options
 * @param {number} options.topK - Number of top people to return (default 15)
 * @param {number[]} options.networkPersonIds - Limit to these person IDs (user's network)
 * @param {number} options.minSimilarity - Minimum similarity threshold (default 0.3)
 * @returns {Array<{personId, displayName, title, company, similarity, matchedChunks}>}
 */
export async function semanticSearch(queryText, {
  topK = 15,
  networkPersonIds = null,
  minSimilarity = 0.3,
} = {}) {
  const start = Date.now()

  // Embed the query
  const [queryEmbedding] = await getEmbeddings([queryText])
  const queryVec = toVectorLiteral(queryEmbedding)

  // pgvector search — cosine distance, filtered by network if needed
  // We fetch more chunks than topK people since we group by person afterwards
  const maxChunks = topK * 8 // Get enough chunks to cover topK distinct people
  const maxDistance = 1 - minSimilarity // cosine distance = 1 - similarity

  let sql, params

  if (networkPersonIds && networkPersonIds.length > 0) {
    sql = `
      SELECT
        emb.person_id,
        emb.source_type,
        emb.source_text,
        emb.expertise_id,
        emb.content_id,
        1 - (emb.embedding <=> $1::vector) AS similarity,
        p.display_name,
        p.current_title,
        p.current_company
      FROM person_embeddings emb
      JOIN people p ON p.id = emb.person_id
      WHERE emb.person_id = ANY($2)
        AND (emb.embedding <=> $1::vector) <= $3
      ORDER BY emb.embedding <=> $1::vector
      LIMIT $4
    `
    params = [queryVec, networkPersonIds, maxDistance, maxChunks]
  } else {
    sql = `
      SELECT
        emb.person_id,
        emb.source_type,
        emb.source_text,
        emb.expertise_id,
        emb.content_id,
        1 - (emb.embedding <=> $1::vector) AS similarity,
        p.display_name,
        p.current_title,
        p.current_company
      FROM person_embeddings emb
      JOIN people p ON p.id = emb.person_id
      WHERE (emb.embedding <=> $1::vector) <= $2
      ORDER BY emb.embedding <=> $1::vector
      LIMIT $3
    `
    params = [queryVec, maxDistance, maxChunks]
  }

  const res = await query(sql, params)

  // Group by person — take best score per person, collect all matching chunks
  const byPerson = new Map()
  for (const row of res.rows) {
    const sim = parseFloat(row.similarity)
    const existing = byPerson.get(row.person_id)
    if (!existing) {
      byPerson.set(row.person_id, {
        personId: row.person_id,
        displayName: row.display_name,
        title: row.current_title,
        company: row.current_company,
        topSimilarity: sim,
        matchedChunks: [{
          sourceType: row.source_type,
          text: row.source_text,
          similarity: sim,
          expertiseId: row.expertise_id,
          contentId: row.content_id,
        }],
      })
    } else {
      existing.matchedChunks.push({
        sourceType: row.source_type,
        text: row.source_text,
        similarity: sim,
        expertiseId: row.expertise_id,
        contentId: row.content_id,
      })
      if (sim > existing.topSimilarity) {
        existing.topSimilarity = sim
      }
    }
  }

  // Sort by top similarity, take topK
  const results = [...byPerson.values()]
    .sort((a, b) => b.topSimilarity - a.topSimilarity)
    .slice(0, topK)

  // Trim each person's matched chunks — already ordered by distance from SQL
  for (const r of results) {
    r.matchedChunks = r.matchedChunks.slice(0, 5) // Keep top 5 per person
  }

  const elapsed = Date.now() - start
  console.log(`[Embed] Search | "${queryText.slice(0, 60)}..." | ${res.rows.length} matches → ${results.length} people | ${elapsed}ms`)

  return results
}


// ── LinkedIn Connection Embeddings ──────────────────────────────────

/**
 * Embed LinkedIn connections for a user.
 * Each connection gets one embedding from "{title} at {company}".
 * @param {number} ownerId - The owner's person ID
 * @param {number[]} connectionIds - Connection IDs to embed (or all if empty)
 */
export async function embedLinkedInConnections(ownerId, connectionIds = []) {
  const start = Date.now()

  let sql = `
    SELECT lc.id, lc.first_name, lc.last_name, lc.title, lc.company
    FROM linkedin_connections lc
    LEFT JOIN linkedin_connection_embeddings lce ON lce.connection_id = lc.id
    WHERE lc.owner_id = $1 AND lce.id IS NULL
  `
  const params = [ownerId]
  if (connectionIds.length > 0) {
    sql += ` AND lc.id = ANY($2)`
    params.push(connectionIds)
  }

  const res = await query(sql, params)
  if (res.rows.length === 0) {
    console.log(`[Embed] LinkedIn connections for owner ${ownerId}: nothing to embed`)
    return { embedded: 0 }
  }

  // Build embedding texts
  const items = []
  for (const row of res.rows) {
    const parts = []
    if (row.title && row.company) parts.push(`${row.title} at ${row.company}`)
    else if (row.title) parts.push(row.title)
    else if (row.company) parts.push(row.company)
    else parts.push(`${row.first_name} ${row.last_name}`)
    items.push({ connectionId: row.id, text: parts[0] })
  }

  const embeddings = await getEmbeddings(items.map(i => i.text))

  let saved = 0
  for (let i = 0; i < items.length; i++) {
    try {
      await query(`
        INSERT INTO linkedin_connection_embeddings (connection_id, source_text, embedding)
        VALUES ($1, $2, $3::vector)
        ON CONFLICT DO NOTHING
      `, [items[i].connectionId, items[i].text.slice(0, 1000), toVectorLiteral(embeddings[i])])
      saved++
    } catch (err) {
      console.error(`[Embed] LinkedIn connection ${items[i].connectionId} error: ${err.message}`)
    }
  }

  console.log(`[Embed] LinkedIn connections for owner ${ownerId}: ${saved}/${items.length} embedded | ${Date.now() - start}ms`)
  return { embedded: saved }
}

/**
 * Semantic search across a user's LinkedIn connections.
 * @param {string} queryText - The search query
 * @param {number} ownerId - The owner's person ID
 * @param {object} options
 * @returns {Array<{connectionId, name, title, company, similarity, matchedText}>}
 */
export async function searchLinkedInConnections(queryText, ownerId, {
  topK = 5,
  minSimilarity = 0.2,
  excludePersonIds = [],
} = {}) {
  const [queryEmbedding] = await getEmbeddings([queryText])
  const queryVec = toVectorLiteral(queryEmbedding)
  const maxDistance = 1 - minSimilarity

  let sql = `
    SELECT
      lc.id AS connection_id,
      lc.first_name,
      lc.last_name,
      lc.display_name,
      lc.title,
      lc.company,
      lc.linkedin_url,
      lc.matched_person_id,
      lc.ai_summary,
      lc.enriched_at,
      lce.source_text,
      1 - (lce.embedding <=> $1::vector) AS similarity
    FROM linkedin_connection_embeddings lce
    JOIN linkedin_connections lc ON lc.id = lce.connection_id
    WHERE lc.owner_id = $2
      AND (lce.embedding <=> $1::vector) <= $3
  `
  const params = [queryVec, ownerId, maxDistance]

  if (excludePersonIds.length > 0) {
    sql += ` AND (lc.matched_person_id IS NULL OR lc.matched_person_id != ALL($4))`
    params.push(excludePersonIds)
  }

  sql += ` ORDER BY lce.embedding <=> $1::vector LIMIT $${params.length + 1}`
  params.push(topK)

  const res = await query(sql, params)

  return res.rows.map(r => ({
    connectionId: r.connection_id,
    name: r.display_name,
    title: r.title,
    company: r.company,
    linkedinUrl: r.linkedin_url,
    aiSummary: r.ai_summary || null,
    enrichedAt: r.enriched_at || null,
    similarity: parseFloat(r.similarity),
    matchedText: r.source_text,
  }))
}

// ── Stats ───────────────────────────────────────────────────────────

/**
 * Get embedding stats for admin/monitoring.
 */
export async function getEmbeddingStats() {
  const res = await query(`
    SELECT
      COUNT(*) AS total_embeddings,
      COUNT(DISTINCT person_id) AS people_with_embeddings,
      COUNT(*) FILTER (WHERE source_type = 'expertise') AS expertise_embeddings,
      COUNT(*) FILTER (WHERE source_type = 'content') AS content_embeddings,
      MIN(created_at) AS oldest,
      MAX(created_at) AS newest
    FROM person_embeddings
  `)
  return res.rows[0]
}
