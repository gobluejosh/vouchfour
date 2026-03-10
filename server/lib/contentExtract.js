import { query } from './db.js'
import crypto from 'crypto'

// Read API key lazily to avoid module-load-order issues with dotenv
const getApiKey = () => process.env.ANTHROPIC_API_KEY
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── URL Classification ──────────────────────────────────────────────
// Categorize Brave result URLs into content types worth fetching.

const PLATFORM_PATTERNS = {
  medium:    [/medium\.com/, /\.medium\.com/],
  substack:  [/substack\.com/],
  github:    [/github\.com/],
  youtube:   [/youtube\.com/, /youtu\.be/],
  podcast:   [/podcasts\.apple\.com/, /podtail\.com/, /listennotes\.com/, /listen\.com/, /spotify\.com\/episode/, /audible\.com/],
  conference:[/events\.com/, /summit/, /conference/, /cnbcevents\.com/],
}

// Domains we never want to fetch content from
const SKIP_DOMAINS = new Set([
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'zoominfo.com', 'rocketreach.co', 'signalhire.com', 'apollo.io',
  'theorg.com', 'crunchbase.com', 'pitchbook.com', 'bloomberg.com',
  'dnb.com', 'opencorporates.com', 'peoplelooker.com', 'whitepages.com',
  'spokeo.com', 'beenverified.com', 'truepeoplesearch.com',
  'wiza.co', 'contactout.com', 'lusha.com',
  'officialusa.com', 'athletic.net', 'sports-reference.com',
  'proballers.com', 'keybase.io',
])

/**
 * Classify a Brave result URL into a content type.
 * Returns { platform, contentType } or null if we should skip.
 */
export function classifyUrl(url) {
  let hostname
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  // Skip noise domains
  if ([...SKIP_DOMAINS].some(d => hostname.includes(d))) return null

  // Check platform patterns
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some(p => p.test(url))) {
      const contentType =
        platform === 'medium' || platform === 'substack' ? 'blog_post' :
        platform === 'github' ? 'github_profile' :
        platform === 'youtube' ? 'video' :
        platform === 'podcast' ? 'podcast' :
        platform === 'conference' ? 'conference_talk' : null
      return { platform, contentType }
    }
  }

  // Check URL/title for blog-like content signals
  const pathLower = url.toLowerCase()
  if (pathLower.includes('/blog/') || pathLower.includes('/post/') || pathLower.includes('/article/')) {
    return { platform: 'other', contentType: 'blog_post' }
  }

  // Generic content pages (talks, interviews on other sites)
  return { platform: 'other', contentType: null }
}


// ── Content Fetchers ────────────────────────────────────────────────
// Each fetcher returns an array of content items ready for storage.

/**
 * Fetch Medium articles via RSS feed.
 * @param {string} mediumUrl - any medium.com URL for this person
 * @param {string} personName - for logging
 * @returns {Array<{title, url, summary, topics, metadata}>}
 */
export async function fetchMediumContent(mediumUrl, personName) {
  // Extract username from URL patterns:
  // medium.com/@username/article-slug OR username.medium.com/article-slug
  let username = null
  try {
    const parsed = new URL(mediumUrl)
    const hostParts = parsed.hostname.split('.')
    if (hostParts.length === 3 && hostParts[1] === 'medium') {
      username = hostParts[0]
    } else {
      const pathMatch = parsed.pathname.match(/^\/@([^/]+)/)
      if (pathMatch) username = pathMatch[1]
    }
  } catch {}

  if (!username) {
    console.warn(`[Content] Could not extract Medium username from ${mediumUrl}`)
    return []
  }

  const feedUrl = `https://medium.com/feed/@${username}`
  console.log(`[Content] Fetching Medium RSS: ${feedUrl}`)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VouchFour/1.0 (content enrichment)' },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.warn(`[Content] Medium RSS returned ${res.status} for ${username}`)
      return []
    }

    const xml = await res.text()
    return parseMediumRss(xml, personName)
  } catch (err) {
    console.warn(`[Content] Medium RSS fetch failed for ${username}: ${err.message}`)
    return []
  }
}

/**
 * Parse Medium RSS XML into content items.
 */
function parseMediumRss(xml, personName) {
  const items = []

  // Simple XML parsing — extract <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const pubDate = extractTag(block, 'pubDate')

    // Extract categories (tags)
    const categories = []
    const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g
    let catMatch
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1].toLowerCase())
    }

    // Extract content:encoded for article text
    const contentMatch = block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)
    let articleText = ''
    if (contentMatch) {
      // Strip HTML to get plain text, take first ~1500 chars
      articleText = contentMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1500)
    }

    if (title && link) {
      items.push({
        contentType: 'blog_post',
        platform: 'medium',
        title,
        url: link,
        rawText: articleText,
        topics: categories,
        metadata: { pubDate, author: personName },
      })
    }
  }

  console.log(`[Content] Medium RSS: ${items.length} articles found`)
  return items
}

/**
 * Fetch GitHub profile and notable repos via API.
 * @param {string} githubUrl - github.com URL for this person
 * @returns {Array<{contentType, title, url, rawText, topics, metadata}>}
 */
export async function fetchGitHubContent(githubUrl) {
  // Extract username from URL
  let username = null
  try {
    const parsed = new URL(githubUrl)
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 1) username = parts[0]
  } catch {}

  if (!username) {
    console.warn(`[Content] Could not extract GitHub username from ${githubUrl}`)
    return []
  }

  console.log(`[Content] Fetching GitHub profile: ${username}`)
  const items = []

  try {
    // Fetch profile
    const profileRes = await fetch(`https://api.github.com/users/${username}`, {
      headers: {
        'User-Agent': 'VouchFour/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    })

    if (!profileRes.ok) {
      console.warn(`[Content] GitHub profile API returned ${profileRes.status} for ${username}`)
      return []
    }

    const profile = await profileRes.json()
    await sleep(500) // Be nice to GitHub API

    // Fetch repos (owned, not forks, sorted by stars)
    const reposRes = await fetch(
      `https://api.github.com/users/${username}/repos?type=owner&sort=stars&per_page=100`,
      {
        headers: {
          'User-Agent': 'VouchFour/1.0',
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    )

    if (!reposRes.ok) {
      console.warn(`[Content] GitHub repos API returned ${reposRes.status} for ${username}`)
      return []
    }

    const repos = await reposRes.json()

    // Filter to non-fork repos only
    const ownRepos = repos.filter(r => !r.fork)

    // Compute language distribution
    const langCounts = {}
    for (const r of ownRepos) {
      if (r.language) {
        langCounts[r.language] = (langCounts[r.language] || 0) + 1
      }
    }
    const topLangs = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => ({ language: lang, repos: count }))

    // Total stars across all repos
    const totalStars = ownRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0)

    // Build profile summary text
    const profileParts = []
    profileParts.push(`GitHub user ${username} with ${profile.public_repos} public repos and ${profile.followers} followers.`)
    if (profile.bio) profileParts.push(`Bio: ${profile.bio}`)
    if (profile.company) profileParts.push(`Company: ${profile.company}`)
    if (topLangs.length > 0) {
      profileParts.push(`Primary languages: ${topLangs.map(l => `${l.language} (${l.repos} repos)`).join(', ')}`)
    }
    profileParts.push(`Total stars across repos: ${totalStars}`)

    // Profile-level item
    items.push({
      contentType: 'github_profile',
      platform: 'github',
      title: `${profile.name || username} on GitHub`,
      url: `https://github.com/${username}`,
      rawText: profileParts.join('\n'),
      topics: topLangs.map(l => l.language.toLowerCase()),
      metadata: {
        username,
        name: profile.name,
        bio: profile.bio,
        company: profile.company,
        blog: profile.blog,
        publicRepos: profile.public_repos,
        followers: profile.followers,
        createdAt: profile.created_at,
        totalStars,
        topLanguages: topLangs,
      },
    })

    // Notable repos (starred > 0 OR has meaningful description)
    const notableRepos = ownRepos.filter(r =>
      r.stargazers_count >= 5 || (r.description && r.description.length > 20)
    ).slice(0, 15)

    for (const r of notableRepos) {
      const repoParts = []
      repoParts.push(`${r.name}: ${r.description || '(no description)'}`)
      if (r.language) repoParts.push(`Language: ${r.language}`)
      repoParts.push(`Stars: ${r.stargazers_count}, Forks: ${r.forks_count}`)
      if (r.homepage) repoParts.push(`Homepage: ${r.homepage}`)

      items.push({
        contentType: 'github_repo',
        platform: 'github',
        title: r.name,
        url: r.html_url,
        rawText: repoParts.join('\n'),
        topics: [r.language?.toLowerCase()].filter(Boolean),
        metadata: {
          name: r.name,
          description: r.description,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          homepage: r.homepage,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        },
      })
    }

    console.log(`[Content] GitHub: ${ownRepos.length} owned repos, ${notableRepos.length} notable, ${topLangs.length} languages`)
    return items
  } catch (err) {
    console.warn(`[Content] GitHub fetch failed for ${username}: ${err.message}`)
    return []
  }
}

/**
 * Fetch YouTube video metadata via oEmbed API.
 * @param {string} youtubeUrl - YouTube video URL
 * @param {object} braveResult - original Brave result with title/description
 * @returns {Array<{contentType, title, url, rawText, topics, metadata}>}
 */
export async function fetchYouTubeContent(youtubeUrl, braveResult = {}) {
  console.log(`[Content] Fetching YouTube oEmbed: ${youtubeUrl}`)

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(oembedUrl, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) {
      console.warn(`[Content] YouTube oEmbed returned ${res.status}`)
      return []
    }

    const data = await res.json()

    // Combine oEmbed title with Brave's description (which often has better detail)
    const textParts = []
    textParts.push(`Video: ${data.title}`)
    if (braveResult.description) {
      const cleanDesc = braveResult.description.replace(/<[^>]+>/g, '').trim()
      textParts.push(`Description: ${cleanDesc}`)
    }
    if (data.author_name) textParts.push(`Channel: ${data.author_name}`)

    return [{
      contentType: 'video',
      platform: 'youtube',
      title: data.title,
      url: youtubeUrl,
      rawText: textParts.join('\n'),
      topics: [],
      metadata: {
        authorName: data.author_name,
        authorUrl: data.author_url,
        thumbnailUrl: data.thumbnail_url,
        braveTitle: braveResult.title,
        braveDescription: braveResult.description,
      },
    }]
  } catch (err) {
    console.warn(`[Content] YouTube oEmbed failed: ${err.message}`)

    // Fall back to Brave snippet if available
    if (braveResult.title && braveResult.description) {
      return [{
        contentType: 'video',
        platform: 'youtube',
        title: braveResult.title,
        url: youtubeUrl,
        rawText: `Video: ${braveResult.title}\nDescription: ${braveResult.description.replace(/<[^>]+>/g, '').trim()}`,
        topics: [],
        metadata: { source: 'brave_fallback', braveTitle: braveResult.title, braveDescription: braveResult.description },
      }]
    }

    return []
  }
}

/**
 * Fetch a generic web page and extract text content.
 * Good for podcast show-notes, conference pages, personal blogs.
 * @param {string} url
 * @param {object} braveResult - original Brave result
 * @param {string} contentType - 'podcast', 'conference_talk', 'blog_post'
 * @returns {Array<{contentType, title, url, rawText, topics, metadata}>}
 */
export async function fetchPageContent(url, braveResult = {}, contentType = 'blog_post') {
  console.log(`[Content] Fetching page: ${url}`)

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VouchFour/1.0; content enrichment)',
        'Accept': 'text/html',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.warn(`[Content] Page fetch returned ${res.status} for ${url}`)
      // Fall back to Brave snippet
      if (braveResult.title) {
        return [{
          contentType,
          platform: 'other',
          title: braveResult.title,
          url,
          rawText: `${braveResult.title}\n${(braveResult.description || '').replace(/<[^>]+>/g, '').trim()}`,
          topics: [],
          metadata: { source: 'brave_fallback' },
        }]
      }
      return []
    }

    const html = await res.text()

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    let title = titleMatch ? titleMatch[1].trim() : braveResult.title || ''
    // Clean HTML entities
    title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')

    // Extract meta description
    const metaDescMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["']([\s\S]*?)["']/i)
      || html.match(/<meta\s+content=["']([\s\S]*?)["']\s+(?:name|property)=["'](?:description|og:description)["']/i)
    const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : ''

    // Extract article body text (simplified — get main content)
    let bodyText = ''
    // Try <article> tag first
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (articleMatch) {
      bodyText = articleMatch[1]
    } else {
      // Try <main> or fall back to <body>
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      if (mainMatch) bodyText = mainMatch[1]
    }

    // Strip HTML from body text
    bodyText = bodyText
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000)

    // Build the raw text for Claude
    const textParts = []
    textParts.push(`Title: ${title}`)
    if (metaDesc) textParts.push(`Description: ${metaDesc}`)
    if (bodyText && bodyText.length > 100) textParts.push(`Content: ${bodyText}`)
    else if (braveResult.description) {
      textParts.push(`Description: ${braveResult.description.replace(/<[^>]+>/g, '').trim()}`)
    }

    return [{
      contentType,
      platform: detectPlatform(url),
      title: title || braveResult.title || url,
      url,
      rawText: textParts.join('\n'),
      topics: [],
      metadata: {
        metaDescription: metaDesc,
        bodyLength: bodyText.length,
        braveTitle: braveResult.title,
        braveDescription: braveResult.description,
      },
    }]
  } catch (err) {
    console.warn(`[Content] Page fetch failed for ${url}: ${err.message}`)
    // Fall back to Brave snippet
    if (braveResult.title) {
      return [{
        contentType,
        platform: detectPlatform(url),
        title: braveResult.title,
        url,
        rawText: `${braveResult.title}\n${(braveResult.description || '').replace(/<[^>]+>/g, '').trim()}`,
        topics: [],
        metadata: { source: 'brave_fallback' },
      }]
    }
    return []
  }
}

function detectPlatform(url) {
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some(p => p.test(url))) return platform
  }
  return 'other'
}


// ── Claude Topic Extraction ──────────────────────────────────────────

const TOPIC_EXTRACTION_PROMPT = `You are analyzing content created by or featuring a professional. Extract structured topic/expertise signals from this content.

For each piece of content, produce a JSON object with:
- "title": cleaned-up title
- "summary": 1-2 sentence summary of what this content is about and what expertise it demonstrates
- "topics": array of lowercase topic tags (e.g., "pricing-strategy", "team-building", "data-engineering", "edtech")
- "expertise_signal": how strong this is as an expertise signal: "strong" (they wrote/presented on it), "medium" (they were interviewed about it), "weak" (mentioned in passing)

For GitHub profiles, also include:
- "technical_identity": 1-2 sentence description of their technical profile (languages, domains, notable projects)

Output a JSON array. No markdown, no commentary.`

/**
 * Run Claude topic extraction over fetched content items.
 * Groups items by person and runs a single Claude call per person.
 */
export async function extractTopics(contentItems, personName) {
  if (contentItems.length === 0) return []

  const prompt = `Person: ${personName}\n\nContent items:\n${contentItems.map((item, i) => {
    return `\n--- Item ${i + 1} (${item.contentType} from ${item.platform}) ---\n${item.rawText}`
  }).join('\n')}`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: TOPIC_EXTRACTION_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const result = await res.json()
    clearTimeout(timeout)

    if (result.type === 'error') {
      console.error(`[Content] Claude error:`, result.error?.message)
      return contentItems // Return items without enrichment
    }

    const text = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    let cleaned = text.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    try {
      const extracted = JSON.parse(cleaned)
      if (!Array.isArray(extracted)) return contentItems

      // Merge extracted data back into content items
      for (let i = 0; i < contentItems.length && i < extracted.length; i++) {
        const ext = extracted[i]
        if (ext.summary) contentItems[i].summary = ext.summary
        if (ext.topics) contentItems[i].topics = ext.topics
        if (ext.expertise_signal) contentItems[i].metadata.expertiseSignal = ext.expertise_signal
        if (ext.technical_identity) contentItems[i].metadata.technicalIdentity = ext.technical_identity
      }
    } catch (parseErr) {
      console.error(`[Content] Claude JSON parse failed:`, parseErr.message)
    }

    return contentItems
  } catch (err) {
    console.error(`[Content] Claude topic extraction failed:`, err.message)
    return contentItems
  }
}


// ── Main Pipeline ───────────────────────────────────────────────────

/**
 * Discover and extract content for a person.
 * Uses their Brave results to find content sources, then fetches and processes them.
 *
 * @param {number} personId
 * @param {object} options
 * @param {boolean} options.force - re-extract even if content already exists
 * @param {boolean} options.verbose - extra logging
 * @returns {Array} saved content items
 */
export async function extractContent(personId, { force = false, verbose = false } = {}) {
  const start = Date.now()

  // Get person info
  const personRes = await query('SELECT id, display_name FROM people WHERE id = $1', [personId])
  const person = personRes.rows[0]
  if (!person) {
    console.warn(`[Content] Person ${personId} not found`)
    return []
  }

  // Check if content already exists
  if (!force) {
    const existingRes = await query('SELECT COUNT(*) as count FROM person_content WHERE person_id = $1', [personId])
    if (parseInt(existingRes.rows[0].count) > 0) {
      console.log(`[Content] ${person.display_name} already has content (use force=true to re-extract)`)
      return []
    }
  }

  console.log(`[Content] Starting content extraction for ${person.display_name}`)

  // Get Brave results
  const braveRes = await query(
    `SELECT raw_payload FROM person_enrichment WHERE person_id = $1 AND source = 'brave'`,
    [personId]
  )

  const braveResults = []
  if (braveRes.rows[0]?.raw_payload) {
    const payload = typeof braveRes.rows[0].raw_payload === 'string'
      ? JSON.parse(braveRes.rows[0].raw_payload)
      : braveRes.rows[0].raw_payload
    const all = [...(payload.results1 || []), ...(payload.results2 || []), ...(payload.results3 || [])]
    const seen = new Set()
    for (const r of all) {
      if (!r.url || seen.has(r.url)) continue
      seen.add(r.url)
      braveResults.push(r)
    }
  }

  if (braveResults.length === 0) {
    console.warn(`[Content] No Brave results for ${person.display_name}`)
    return []
  }

  // Classify all URLs
  const classified = braveResults
    .map(r => ({ ...r, ...classifyUrl(r.url) }))
    .filter(r => r.platform && r.contentType)

  if (verbose) {
    console.log(`[Content] Classified ${classified.length}/${braveResults.length} URLs:`)
    classified.forEach(r => console.log(`  ${r.platform}/${r.contentType}: ${r.url}`))
  }

  // Group by platform for smart fetching
  const byPlatform = {}
  for (const r of classified) {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = []
    byPlatform[r.platform].push(r)
  }

  // Fetch content from each platform
  const allContent = []

  // Medium — use RSS (gets ALL articles, not just ones Brave found)
  if (byPlatform.medium) {
    const mediumUrl = byPlatform.medium[0].url
    const mediumItems = await fetchMediumContent(mediumUrl, person.display_name)
    allContent.push(...mediumItems)
    await sleep(500)
  }

  // GitHub — use API
  if (byPlatform.github) {
    const githubUrl = byPlatform.github[0].url
    const githubItems = await fetchGitHubContent(githubUrl)
    allContent.push(...githubItems)
    await sleep(500)
  }

  // YouTube — use oEmbed for each video
  if (byPlatform.youtube) {
    for (const r of byPlatform.youtube.slice(0, 5)) {
      const ytItems = await fetchYouTubeContent(r.url, r)
      allContent.push(...ytItems)
      await sleep(300)
    }
  }

  // Podcasts — fetch page for show notes
  if (byPlatform.podcast) {
    for (const r of byPlatform.podcast.slice(0, 5)) {
      const podItems = await fetchPageContent(r.url, r, 'podcast')
      allContent.push(...podItems)
      await sleep(300)
    }
  }

  // Conferences — fetch page
  if (byPlatform.conference) {
    for (const r of byPlatform.conference.slice(0, 5)) {
      const confItems = await fetchPageContent(r.url, r, 'conference_talk')
      allContent.push(...confItems)
      await sleep(300)
    }
  }

  // Substack — fetch page (RSS would need subdomain detection)
  if (byPlatform.substack) {
    for (const r of byPlatform.substack.slice(0, 3)) {
      const ssItems = await fetchPageContent(r.url, r, 'blog_post')
      allContent.push(...ssItems)
      await sleep(300)
    }
  }

  // Other blogs/articles
  if (byPlatform.other) {
    const blogLike = byPlatform.other.filter(r => r.contentType === 'blog_post')
    for (const r of blogLike.slice(0, 5)) {
      const items = await fetchPageContent(r.url, r, 'blog_post')
      allContent.push(...items)
      await sleep(300)
    }
  }

  if (allContent.length === 0) {
    console.log(`[Content] No fetchable content found for ${person.display_name}`)
    return []
  }

  console.log(`[Content] Fetched ${allContent.length} content items, running topic extraction...`)

  // Run Claude topic extraction
  const enrichedContent = await extractTopics(allContent, person.display_name)

  // Save to DB — clear old content first if force
  if (force) {
    await query('DELETE FROM person_content WHERE person_id = $1', [personId])
  }

  let saved = 0
  for (const item of enrichedContent) {
    const hash = crypto.createHash('md5')
      .update(`${item.title || ''}|${item.url || ''}`)
      .digest('hex')

    try {
      await query(`
        INSERT INTO person_content (person_id, content_type, source_url, source_platform, discovered_via, title, content_summary, topics, raw_metadata, content_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (person_id, content_type, content_hash) DO UPDATE SET
          content_summary = EXCLUDED.content_summary,
          topics = EXCLUDED.topics,
          raw_metadata = EXCLUDED.raw_metadata,
          updated_at = NOW()
      `, [
        personId,
        item.contentType,
        item.url,
        item.platform,
        item.discoveredVia || 'brave',
        item.title,
        item.summary || item.rawText?.slice(0, 500),
        item.topics || [],
        JSON.stringify(item.metadata || {}),
        hash,
      ])
      saved++
    } catch (err) {
      console.error(`[Content] DB insert failed for "${item.title}": ${err.message}`)
    }
  }

  const elapsed = Date.now() - start
  console.log(`[Content] ${person.display_name} | ${saved} items saved | ${elapsed}ms`)

  return enrichedContent
}

/**
 * Batch content extraction.
 */
export async function extractContentBatch(personIds, { delayMs = 3000, force = false, verbose = false } = {}) {
  if (!personIds || personIds.length === 0) {
    const res = await query(`
      SELECT DISTINCT pe.person_id FROM person_enrichment pe
      WHERE pe.source = 'brave' AND pe.raw_payload IS NOT NULL
      ORDER BY pe.person_id
    `)
    personIds = res.rows.map(r => r.person_id)
  }

  console.log(`[Content] Starting batch extraction for ${personIds.length} people`)
  const results = { success: 0, skipped: 0, failed: 0 }

  for (let i = 0; i < personIds.length; i++) {
    const personId = personIds[i]
    console.log(`[Content] Processing ${i + 1}/${personIds.length} (person_id=${personId})`)

    try {
      const items = await extractContent(personId, { force, verbose })
      if (items.length > 0) results.success++
      else results.skipped++
    } catch (err) {
      console.error(`[Content] Failed for person_id=${personId}: ${err.message}`)
      results.failed++
    }

    if (i < personIds.length - 1) await sleep(delayMs)
  }

  console.log(`[Content] Batch complete: ${results.success} success, ${results.skipped} skipped, ${results.failed} failed`)
  return results
}
