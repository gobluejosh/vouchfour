// Extract company logos from Apollo data + domain-based fallbacks
// Generates a static HTML page for visual review
// Usage: node server/scripts/extract-company-logos.js
//   Outputs: server/scripts/company-logos.html

import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '../../.env'), override: true })

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  console.log('[Logos] Starting company logo extraction...')

  // Step 1: Get current company logo + domain from Apollo org data
  const apolloRes = await pool.query(`
    SELECT DISTINCT ON (pe.raw_payload->'person'->'organization'->>'name')
      pe.raw_payload->'person'->'organization'->>'name' AS company_name,
      pe.raw_payload->'person'->'organization'->>'logo_url' AS apollo_logo_url,
      pe.raw_payload->'person'->'organization'->>'primary_domain' AS primary_domain,
      pe.raw_payload->'person'->'organization'->>'website_url' AS website_url
    FROM person_enrichment pe
    WHERE pe.source = 'apollo'
      AND pe.raw_payload->'person'->'organization'->>'name' IS NOT NULL
    ORDER BY pe.raw_payload->'person'->'organization'->>'name', pe.enriched_at DESC
  `)
  console.log(`[Logos] Found ${apolloRes.rows.length} companies from Apollo org data`)

  // Build a map of company name -> { apollo_logo_url, domain }
  const companyMap = new Map()
  for (const row of apolloRes.rows) {
    const name = row.company_name?.trim()
    if (!name) continue
    const domain = row.primary_domain || extractDomain(row.website_url)
    companyMap.set(name.toLowerCase(), {
      name,
      apollo_logo_url: row.apollo_logo_url || null,
      domain: domain || null,
    })
  }

  // Step 2: Get ALL unique company names from employment_history
  const empRes = await pool.query(`
    SELECT organization, COUNT(*) AS person_count
    FROM employment_history
    GROUP BY organization
    ORDER BY COUNT(*) DESC
  `)
  console.log(`[Logos] Found ${empRes.rows.length} unique companies from employment_history`)

  // Step 3: Also try to extract organization_id -> logo from Apollo employment_history entries
  const apolloEmpRes = await pool.query(`
    SELECT
      pe.raw_payload->'person'->'employment_history' AS emp_history
    FROM person_enrichment pe
    WHERE pe.source = 'apollo'
      AND pe.raw_payload->'person'->'employment_history' IS NOT NULL
  `)

  // Build a secondary map: org name from Apollo employment entries -> organization_id
  const apolloOrgIds = new Map()
  for (const row of apolloEmpRes.rows) {
    const history = row.emp_history || []
    for (const job of history) {
      if (job.organization_name && job.organization_id) {
        apolloOrgIds.set(job.organization_name.toLowerCase(), job.organization_id)
      }
    }
  }
  console.log(`[Logos] Found ${apolloOrgIds.size} org IDs from Apollo employment histories`)

  // Step 4: Build the final company list with logo sources
  const companies = []
  const seen = new Set()

  for (const row of empRes.rows) {
    const name = row.organization?.trim()
    if (!name || name === 'Unknown') continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const apolloData = companyMap.get(key)
    const domain = apolloData?.domain || guessDomain(name)
    const apolloOrgId = apolloOrgIds.get(key) || null

    companies.push({
      name: apolloData?.name || name,
      person_count: parseInt(row.person_count),
      apollo_logo_url: apolloData?.apollo_logo_url || null,
      domain,
      apolloOrgId,
      // Logo sources to try (in order of preference)
      clearbit_url: domain ? `https://logo.clearbit.com/${domain}` : null,
      google_favicon_url: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null,
    })
  }

  console.log(`[Logos] Total unique companies: ${companies.length}`)
  console.log(`[Logos] With Apollo logo: ${companies.filter(c => c.apollo_logo_url).length}`)
  console.log(`[Logos] With domain (for Clearbit): ${companies.filter(c => c.domain).length}`)
  console.log(`[Logos] No logo source: ${companies.filter(c => !c.apollo_logo_url && !c.domain).length}`)

  // Step 5: Generate HTML page
  const html = generateHTML(companies)
  const outPath = join(__dirname, 'company-logos.html')
  writeFileSync(outPath, html)
  console.log(`[Logos] HTML written to ${outPath}`)

  await pool.end()
}

function extractDomain(url) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Simple heuristic: "Google" -> "google.com", "Meta Platforms, Inc." -> "meta.com"
function guessDomain(name) {
  const cleaned = name
    .replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|Group|Holdings|Incorporated|Corporation|Company|International|Technologies|Technology|Consulting|Solutions|Services|Partners|Ventures|Capital|Management|Labs?|Studio|Media|Digital|Software|Systems|Networks|Enterprises?)$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

  if (!cleaned || cleaned.length < 2) return null
  return `${cleaned}.com`
}

function generateHTML(companies) {
  const rows = companies.map((c, i) => {
    const apolloImg = c.apollo_logo_url
      ? `<img src="${esc(c.apollo_logo_url)}" alt="" width="32" height="32" onerror="this.style.display='none'" style="border-radius:4px">`
      : '<span class="none">—</span>'

    const clearbitImg = c.clearbit_url
      ? `<img src="${esc(c.clearbit_url)}" alt="" width="32" height="32" onerror="this.style.display='none'" style="border-radius:4px">`
      : '<span class="none">—</span>'

    const faviconImg = c.google_favicon_url
      ? `<img src="${esc(c.google_favicon_url)}" alt="" width="32" height="32" onerror="this.style.display='none'" style="border-radius:4px">`
      : '<span class="none">—</span>'

    const domainBadge = c.domain
      ? `<code>${esc(c.domain)}</code>`
      : '<span class="none">no domain</span>'

    return `
      <tr>
        <td class="idx">${i + 1}</td>
        <td class="name">${esc(c.name)}</td>
        <td class="count">${c.person_count}</td>
        <td class="domain">${domainBadge}</td>
        <td class="logo">${apolloImg}</td>
        <td class="logo">${clearbitImg}</td>
        <td class="logo">${faviconImg}</td>
      </tr>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Company Logos Audit</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; color: #1a1a2e; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th { background: #1a1a2e; color: #fff; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: middle; }
  tr:hover { background: #f0f4ff; }
  .idx { color: #999; font-size: 12px; width: 40px; }
  .name { font-weight: 500; }
  .count { text-align: center; color: #666; font-size: 13px; }
  .domain code { font-size: 12px; background: #e8f0fe; padding: 2px 6px; border-radius: 4px; }
  .logo { text-align: center; width: 60px; }
  .logo img { display: inline-block; background: #f5f5f5; }
  .none { color: #ccc; font-size: 12px; }
  .stats { display: flex; gap: 16px; margin-bottom: 16px; }
  .stat { background: #fff; padding: 12px 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .stat-num { font-size: 24px; font-weight: 700; }
  .stat-label { font-size: 12px; color: #666; }
</style>
</head>
<body>
<h1>Company Logos Audit</h1>
<p class="meta">Generated ${new Date().toISOString().slice(0, 16)} — logos load live from their sources</p>

<div class="stats">
  <div class="stat"><div class="stat-num">${companies.length}</div><div class="stat-label">Total Companies</div></div>
  <div class="stat"><div class="stat-num">${companies.filter(c => c.apollo_logo_url).length}</div><div class="stat-label">Apollo Logo</div></div>
  <div class="stat"><div class="stat-num">${companies.filter(c => c.domain).length}</div><div class="stat-label">Have Domain</div></div>
  <div class="stat"><div class="stat-num">${companies.filter(c => !c.apollo_logo_url && !c.domain).length}</div><div class="stat-label">No Logo Source</div></div>
</div>

<table>
<thead>
  <tr>
    <th>#</th>
    <th>Company</th>
    <th>People</th>
    <th>Domain</th>
    <th>Apollo</th>
    <th>Clearbit</th>
    <th>Favicon</th>
  </tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

main().catch(err => {
  console.error('[Logos] Fatal error:', err)
  process.exit(1)
})
