import { query } from './lib/db.js'
import { buildFingerprint } from './lib/enrich.js'
import fs from 'fs'

const personId = parseInt(process.argv[2] || '1')

// Gather all data
const [personRes, chunksRes, braveRes, summaryRes, historyRes, apolloRes, vouchRes, contentRes] = await Promise.all([
  query('SELECT id, display_name, current_title, current_company, location, industry, headline, photo_url FROM people WHERE id = $1', [personId]),
  query('SELECT chunk_type, chunk_text, tags FROM person_expertise WHERE person_id = $1 ORDER BY chunk_type, id', [personId]),
  query(`SELECT raw_payload FROM person_enrichment WHERE person_id = $1 AND source = 'brave'`, [personId]),
  query(`SELECT ai_summary FROM person_enrichment WHERE person_id = $1 AND source = 'claude' AND ai_summary IS NOT NULL`, [personId]),
  query(`SELECT organization, title, start_date, end_date, is_current, location, description FROM employment_history WHERE person_id = $1 ORDER BY start_date DESC NULLS LAST`, [personId]),
  query(`SELECT raw_payload FROM person_enrichment WHERE person_id = $1 AND source = 'apollo'`, [personId]),
  query(`SELECT jf.name as function_name, p.display_name as voucher_name, p.current_company as voucher_company
         FROM vouches v JOIN job_functions jf ON jf.id = v.job_function_id JOIN people p ON p.id = v.voucher_id
         WHERE v.vouchee_id = $1`, [personId]),
  query(`SELECT content_type, source_platform, title, content_summary, topics, source_url, raw_metadata
         FROM person_content WHERE person_id = $1 ORDER BY content_type, id`, [personId]),
])

const person = personRes.rows[0]
if (!person) { console.error('Person not found'); process.exit(1) }

const chunks = chunksRes.rows
const summary = summaryRes.rows[0]?.ai_summary || ''
const history = historyRes.rows
const vouches = vouchRes.rows
const contentItems = contentRes.rows

// Parse Brave results
let braveData = { results: [], queries: [], fingerprint: [], rawCounts: null, filteredCounts: null }
if (braveRes.rows[0]?.raw_payload) {
  const payload = typeof braveRes.rows[0].raw_payload === 'string'
    ? JSON.parse(braveRes.rows[0].raw_payload)
    : braveRes.rows[0].raw_payload

  braveData.queries = payload.queries || []
  braveData.fingerprint = payload.fingerprint || []
  braveData.rawCounts = payload.raw_counts || null
  braveData.filteredCounts = payload.filtered_counts || null

  const allResults = [...(payload.results1 || []), ...(payload.results2 || []), ...(payload.results3 || [])]
  const seen = new Set()
  for (const r of allResults) {
    if (!r.url || seen.has(r.url)) continue
    seen.add(r.url)
    braveData.results.push(r)
  }
}

// Parse Apollo org data
let apolloOrg = null
if (apolloRes.rows[0]?.raw_payload) {
  const apolloPayload = typeof apolloRes.rows[0].raw_payload === 'string'
    ? JSON.parse(apolloRes.rows[0].raw_payload)
    : apolloRes.rows[0].raw_payload
  const p = apolloPayload.person || apolloPayload
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

// Get current fingerprint
let fingerprint = null
try {
  fingerprint = await buildFingerprint(personId)
} catch (e) {
  console.warn('Could not build fingerprint:', e.message)
}

// Classify brave results
const noiseDomains = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'zoominfo.com', 'rocketreach.co', 'signalhire.com', 'apollo.io',
  'theorg.com', 'crunchbase.com', 'pitchbook.com', 'bloomberg.com',
  'dnb.com', 'opencorporates.com', 'peoplelooker.com', 'whitepages.com',
  'spokeo.com', 'beenverified.com', 'truepeoplesearch.com'
]

function classifyResult(r) {
  try {
    const host = new URL(r.url).hostname.toLowerCase()
    if (noiseDomains.some(d => host.includes(d))) return 'noise'
  } catch {}
  // Check if any fingerprint company appears
  if (fingerprint && fingerprint.companies) {
    const text = `${r.title || ''} ${r.description || ''}`.toLowerCase()
    const hasMatch = fingerprint.companies.some(c => text.toLowerCase().includes(c.toLowerCase()))
    if (!hasMatch) return 'unmatched'
  }
  return 'good'
}

const classifiedResults = braveData.results.map(r => ({
  ...r,
  classification: classifyResult(r),
  hostname: (() => { try { return new URL(r.url).hostname } catch { return r.url } })()
}))

// Chunk type display names and colors
const chunkMeta = {
  trajectory_summary: { label: 'Trajectory Summary', color: '#6366f1', bg: '#eef2ff' },
  transition: { label: 'Career Transition', color: '#0891b2', bg: '#ecfeff' },
  scaling: { label: 'Scaling Moment', color: '#059669', bg: '#ecfdf5' },
  topic: { label: 'Topic Expertise', color: '#d97706', bg: '#fffbeb' },
  functional: { label: 'Functional Depth', color: '#7c3aed', bg: '#f5f3ff' },
  environment: { label: 'Environment', color: '#dc2626', bg: '#fef2f2' },
}

// Build HTML
const escHtml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Profile Report: ${escHtml(person.display_name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 32px 20px; }

  .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 40px 32px; border-radius: 16px; margin-bottom: 32px; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .header .subtitle { font-size: 16px; opacity: 0.85; }
  .header .meta { margin-top: 16px; font-size: 13px; opacity: 0.7; }

  .section { background: white; border-radius: 12px; padding: 28px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .section h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #1e293b; display: flex; align-items: center; gap: 8px; }
  .section h2 .count { background: #e2e8f0; color: #475569; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
  .section h3 { font-size: 14px; font-weight: 600; color: #64748b; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: 0.5px; }

  .summary-text { font-size: 15px; color: #334155; background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 3px solid #6366f1; }

  .chunk { padding: 16px; border-radius: 10px; margin-bottom: 12px; }
  .chunk-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
  .chunk-text { font-size: 14px; line-height: 1.6; }
  .chunk-tags { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: rgba(0,0,0,0.06); color: #475569; }

  .result-card { padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 8px; transition: all 0.15s; }
  .result-card:hover { border-color: #cbd5e1; background: #f8fafc; }
  .result-card.noise { opacity: 0.4; border-style: dashed; }
  .result-card.unmatched { opacity: 0.5; border-left: 3px solid #f59e0b; }
  .result-card.good { border-left: 3px solid #10b981; }
  .result-host { font-size: 11px; color: #94a3b8; font-weight: 500; }
  .result-title { font-size: 14px; font-weight: 600; color: #1e293b; margin: 2px 0; }
  .result-title a { color: inherit; text-decoration: none; }
  .result-title a:hover { color: #4f46e5; }
  .result-desc { font-size: 13px; color: #64748b; }
  .result-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; margin-left: 8px; }
  .badge-good { background: #dcfce7; color: #166534; }
  .badge-noise { background: #fee2e2; color: #991b1b; }
  .badge-unmatched { background: #fef3c7; color: #92400e; }

  .fingerprint { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
  .fp-company { background: #eef2ff; color: #4338ca; padding: 6px 14px; border-radius: 8px; font-size: 14px; font-weight: 600; }

  .query-box { background: #f1f5f9; padding: 12px 16px; border-radius: 8px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; color: #334155; margin-bottom: 8px; word-break: break-all; }

  .job { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
  .job:last-child { border-bottom: none; }
  .job-title { font-weight: 600; font-size: 14px; }
  .job-org { color: #6366f1; font-size: 14px; }
  .job-dates { font-size: 12px; color: #94a3b8; }
  .job-desc { font-size: 13px; color: #64748b; margin-top: 4px; }

  .vouch { font-size: 13px; color: #475569; padding: 4px 0; }
  .vouch-fn { font-weight: 600; color: #4f46e5; }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .stat { background: #f8fafc; padding: 14px; border-radius: 8px; text-align: center; }
  .stat-value { font-size: 24px; font-weight: 700; color: #4f46e5; }
  .stat-label { font-size: 12px; color: #94a3b8; margin-top: 2px; }

  .divider { height: 1px; background: #e2e8f0; margin: 20px 0; }

  .legend { display: flex; gap: 16px; margin-bottom: 16px; font-size: 12px; color: #64748b; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 3px; }
</style>
</head>
<body>
<div class="container">

<div class="header">
  <h1>${escHtml(person.display_name)}</h1>
  <div class="subtitle">${escHtml(person.current_title || '')}${person.current_company ? ` at ${escHtml(person.current_company)}` : ''}</div>
  ${person.location ? `<div class="meta">📍 ${escHtml(person.location)}${person.industry ? ` · ${escHtml(person.industry)}` : ''}</div>` : ''}
  <div class="meta">Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
</div>

<!-- Stats Overview -->
<div class="section">
  <h2>Data Overview</h2>
  <div class="stat-grid">
    <div class="stat"><div class="stat-value">${history.length}</div><div class="stat-label">Employment Roles</div></div>
    <div class="stat"><div class="stat-value">${chunks.length}</div><div class="stat-label">Expertise Chunks</div></div>
    <div class="stat"><div class="stat-value">${contentItems.length}</div><div class="stat-label">Content Items</div></div>
    <div class="stat"><div class="stat-value">${braveData.results.length}</div><div class="stat-label">Web Results</div></div>
    <div class="stat"><div class="stat-value">${classifiedResults.filter(r => r.classification === 'good').length}</div><div class="stat-label">Relevant Results</div></div>
    <div class="stat"><div class="stat-value">${vouches.length}</div><div class="stat-label">Vouches Received</div></div>
  </div>
</div>

<!-- AI Summary -->
${summary ? `
<div class="section">
  <h2>AI Summary (Claude)</h2>
  <div class="summary-text">${escHtml(summary)}</div>
</div>
` : ''}

<!-- Expertise Chunks -->
${chunks.length > 0 ? `
<div class="section">
  <h2>Expertise Chunks <span class="count">${chunks.length}</span></h2>
  <p style="font-size: 13px; color: #94a3b8; margin-bottom: 16px;">These are the structured signals the Brain uses to match you to someone's challenge.</p>
  ${chunks.map(c => {
    const meta = chunkMeta[c.chunk_type] || { label: c.chunk_type, color: '#64748b', bg: '#f8fafc' }
    return `
    <div class="chunk" style="background: ${meta.bg};">
      <div class="chunk-type" style="color: ${meta.color};">${meta.label}</div>
      <div class="chunk-text">${escHtml(c.chunk_text)}</div>
      ${c.tags && c.tags.length > 0 ? `<div class="chunk-tags">${c.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
    </div>`
  }).join('')}
</div>
` : '<div class="section"><h2>Expertise Chunks</h2><p style="color: #94a3b8;">No expertise chunks extracted yet.</p></div>'}

<!-- Discovered Content -->
${contentItems.length > 0 ? `
<div class="section">
  <h2>Discovered Content <span class="count">${contentItems.length} items</span></h2>
  <p style="font-size: 13px; color: #94a3b8; margin-bottom: 16px;">Content fetched from web sources — articles, podcasts, talks, code repos — with Claude-extracted topic signals.</p>
  ${(() => {
    const contentMeta = {
      blog_post: { icon: '📝', label: 'Blog Post', color: '#d97706', bg: '#fffbeb' },
      podcast: { icon: '🎙️', label: 'Podcast', color: '#7c3aed', bg: '#f5f3ff' },
      conference_talk: { icon: '🎤', label: 'Conference Talk', color: '#0891b2', bg: '#ecfeff' },
      video: { icon: '🎬', label: 'Video', color: '#dc2626', bg: '#fef2f2' },
      github_profile: { icon: '💻', label: 'GitHub Profile', color: '#059669', bg: '#ecfdf5' },
      github_repo: { icon: '📦', label: 'Repository', color: '#059669', bg: '#f0fdf4' },
    }
    return contentItems.map(c => {
      const meta = contentMeta[c.content_type] || { icon: '📄', label: c.content_type, color: '#64748b', bg: '#f8fafc' }
      const rawMeta = typeof c.raw_metadata === 'string' ? JSON.parse(c.raw_metadata) : (c.raw_metadata || {})
      const signal = rawMeta.expertiseSignal
      const techId = rawMeta.technicalIdentity
      return `
      <div class="chunk" style="background: ${meta.bg}; border-left: 3px solid ${meta.color};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div class="chunk-type" style="color: ${meta.color};">${meta.icon} ${meta.label} · ${escHtml(c.source_platform)}</div>
          ${signal ? `<span class="tag" style="background: ${signal === 'strong' ? '#dcfce7; color: #166534' : signal === 'medium' ? '#fef3c7; color: #92400e' : '#f1f5f9; color: #64748b'}">${signal} signal</span>` : ''}
        </div>
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">
          ${c.source_url ? `<a href="${escHtml(c.source_url)}" target="_blank" style="color: ${meta.color}; text-decoration: none;">${escHtml(c.title || '(untitled)')}</a>` : escHtml(c.title || '(untitled)')}
        </div>
        ${c.content_summary ? `<div class="chunk-text">${escHtml(c.content_summary)}</div>` : ''}
        ${techId ? `<div style="margin-top: 6px; font-size: 13px; color: #475569; font-style: italic;">${escHtml(techId)}</div>` : ''}
        ${c.topics && c.topics.length > 0 ? `<div class="chunk-tags">${c.topics.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`
    }).join('')
  })()}
</div>
` : ''}

<!-- Fingerprint -->
<div class="section">
  <h2>Network Fingerprint</h2>
  <p style="font-size: 13px; color: #94a3b8; margin-bottom: 12px;">Companies used to disambiguate you in web searches — chosen by how many network members also worked there.</p>
  ${fingerprint ? `
    <div class="fingerprint">
      ${fingerprint.companies.map(c => `<div class="fp-company">${escHtml(c)}</div>`).join('')}
    </div>
    ${fingerprint.industry ? `<div style="font-size: 13px; color: #64748b; margin-top: 8px;">Industry signal: ${escHtml(fingerprint.industry)}</div>` : ''}
  ` : '<p style="color: #94a3b8;">Fingerprint not available.</p>'}

  ${braveData.queries.length > 0 ? `
    <h3>Brave Search Queries</h3>
    ${braveData.queries.map((q, i) => `<div class="query-box">Q${i + 1}: ${escHtml(q)}</div>`).join('')}
  ` : ''}
</div>

<!-- Brave Results -->
<div class="section">
  <h2>Web Discovery (Brave) <span class="count">${braveData.results.length} results</span></h2>
  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background: #10b981;"></div> Matches fingerprint</div>
    <div class="legend-item"><div class="legend-dot" style="background: #f59e0b;"></div> No fingerprint match</div>
    <div class="legend-item"><div class="legend-dot" style="background: #ef4444;"></div> Noise domain</div>
  </div>
  ${classifiedResults.length > 0 ? classifiedResults.map(r => `
    <div class="result-card ${r.classification}">
      <div class="result-host">${escHtml(r.hostname)}
        <span class="result-badge badge-${r.classification}">${r.classification === 'good' ? '✓ Match' : r.classification === 'noise' ? '✗ Noise' : '? No match'}</span>
      </div>
      <div class="result-title"><a href="${escHtml(r.url)}" target="_blank">${escHtml(r.title || '(no title)')}</a></div>
      <div class="result-desc">${escHtml((r.description || '').replace(/<[^>]*>/g, '').slice(0, 250))}</div>
    </div>
  `).join('') : '<p style="color: #94a3b8;">No Brave results stored.</p>'}
</div>

<!-- Employment History -->
<div class="section">
  <h2>Employment History <span class="count">${history.length} roles</span></h2>
  ${history.map(j => {
    const start = j.start_date ? new Date(j.start_date).getFullYear() : '?'
    const end = j.is_current ? 'Present' : (j.end_date ? new Date(j.end_date).getFullYear() : '?')
    return `
    <div class="job">
      <span class="job-title">${escHtml(j.title || 'Role')}</span> <span class="job-org">at ${escHtml(j.organization || 'Unknown')}</span>
      <div class="job-dates">${start} – ${end}${j.location ? ` · ${escHtml(j.location)}` : ''}</div>
      ${j.description ? `<div class="job-desc">${escHtml(j.description)}</div>` : ''}
    </div>`
  }).join('')}
</div>

${apolloOrg ? `
<!-- Apollo Company Data -->
<div class="section">
  <h2>Current Company (Apollo)</h2>
  <div style="font-size: 14px; color: #334155;">
    <strong>${escHtml(apolloOrg.name)}</strong><br>
    ${apolloOrg.employees ? `Employees: ~${apolloOrg.employees}<br>` : ''}
    ${apolloOrg.totalFunding ? `Total Funding: $${escHtml(apolloOrg.totalFunding)}<br>` : ''}
    ${apolloOrg.annualRevenue ? `Annual Revenue: $${escHtml(apolloOrg.annualRevenue)}<br>` : ''}
    ${apolloOrg.fundingStage ? `Stage: ${escHtml(apolloOrg.fundingStage)}<br>` : ''}
    ${apolloOrg.foundedYear ? `Founded: ${apolloOrg.foundedYear}<br>` : ''}
    ${apolloOrg.industry ? `Industry: ${escHtml(apolloOrg.industry)}<br>` : ''}
    ${apolloOrg.description ? `<div style="margin-top: 8px; color: #64748b; font-size: 13px;">${escHtml(apolloOrg.description)}</div>` : ''}
  </div>
</div>
` : ''}

<!-- Vouches -->
${vouches.length > 0 ? `
<div class="section">
  <h2>Vouches Received <span class="count">${vouches.length}</span></h2>
  ${vouches.map(v => `
    <div class="vouch">Vouched for in <span class="vouch-fn">${escHtml(v.function_name)}</span> by <strong>${escHtml(v.voucher_name)}</strong>${v.voucher_company ? ` (${escHtml(v.voucher_company)})` : ''}</div>
  `).join('')}
</div>
` : ''}

</div>
</body>
</html>`

const outPath = `/Users/joshscott/Desktop/profile-report-${person.display_name.toLowerCase().replace(/\s+/g, '-')}.html`
fs.writeFileSync(outPath, html)
console.log(`\nReport written to: ${outPath}`)
console.log(`Open in browser: file://${outPath.replace(/ /g, '%20')}`)

process.exit(0)
