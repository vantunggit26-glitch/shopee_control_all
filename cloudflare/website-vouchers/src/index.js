import { handleVoucherAlerts } from './voucher-alerts.js'

export const SOURCE_URL = 'https://vouchersan.com/ma-hot/'
const FEED_URL = 'https://vouchersan.com/wp-json/vs-tg/v1/feed?limit=100&type=all'
const RETENTION_SECONDS = 5 * 24 * 60 * 60
const HISTORY_LIMIT = 800
const ALLOWED_ORIGINS = new Set(['https://shopeetung.web.app', 'http://localhost:5173', 'http://localhost:4173'])
const htmlEntities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (!name.startsWith('#')) return htmlEntities[name.toLowerCase()] ?? entity
    const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function cleanText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function getLink(href) {
  try {
    const url = new URL(decodeEntities(href), SOURCE_URL)
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 1500) return null
    if (/(^|\.)(shopee\.vn|shp\.ee)$/.test(url.hostname)) return { url: url.href, platform: 'shopee' }
    if (/(^|\.)(lazada\.vn|lzd\.co)$/.test(url.hostname)) return { url: url.href, platform: 'lazada' }
    if (url.hostname !== 'vouchersan.com' || !url.pathname.startsWith('/link/')) return null
    const platform = /^\/link\/sh\//.test(url.pathname) ? 'shopee'
      : /^\/link\/(?:lz|lazada)\//.test(url.pathname) ? 'lazada' : ''
    return { url: url.href, platform }
  } catch {
    return null
  }
}

function extractLinks(html) {
  const links = new Map()
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const link = getLink(match[1])
    if (link) links.set(link.url, link)
    if (links.size >= 6) break
  }
  return [...links.values()]
}

function classText(html, className) {
  const value = html.match(new RegExp(`<span class="${className}"[^>]*>([^<]*)<\\/span>`, 'i'))
  return cleanText(value?.[1])
}

export function parseFeatured(html, now) {
  const records = []
  for (const card of html.split(/<li class="vsvc__item"(?=\s|>)/i).slice(1, 41)) {
    const link = extractLinks(card)[0]
    const amount = classText(card, 'vsvc__big')
    if (!link || !amount) continue
    const minimumOrder = classText(card, 'vsvc__small')
    const group = cleanText(card.match(/^([^>]+)/)?.[1].match(/data-tags="([^"]*)"/)?.[1])
    const date = card.match(/^[^>]*data-hsd="(\d{4}-\d{2}-\d{2})"/)?.[1]
    const expiresAt = date ? Date.parse(`${date}T23:59:59+07:00`) / 1000 : null
    const title = cleanText(
      card.match(/<p class="vsvc__title"[^>]*>([\s\S]*?)<\/p>/i)?.[1].replace(
        /<span class="vsvc__tags">[\s\S]*?<\/span>\s*<\/span>/i, '',
      ),
    ).slice(0, 240)
    const platform = link.platform || (/lazada|tmall/i.test(group) ? 'lazada' : '')
    records.push({
      id: JSON.stringify([group, amount, minimumOrder, title, date ?? '']),
      kind: 'featured',
      title: title || [amount, minimumOrder].filter(Boolean).join(' · '),
      amount,
      minimumOrder,
      group,
      platforms: platform ? [platform] : [],
      links: [link.url],
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      observedAt: now,
    })
  }
  if (!records.length) throw new Error('VoucherSan did not return recognizable featured vouchers')
  return records
}

export function parseFeed(payload, now) {
  if (!Array.isArray(payload.items)) throw new Error('VoucherSan feed did not return an items array')
  return payload.items.flatMap((item) => {
    if (!item?.id || !Number.isFinite(item.ts) || item.ts > now + 300 || item.ts <= now - RETENTION_SECONDS) return []
    const html = String(item.html ?? '').slice(0, 18000)
    const text = cleanText(html)
    const links = extractLinks(html)
    if (!text || !links.length) return []
    const platforms = new Set(links.map((link) => link.platform).filter(Boolean))
    if (/\bshopee\b/i.test(text)) platforms.add('shopee')
    if (/\b(?:lazada|tmall)\b/i.test(text)) platforms.add('lazada')
    return [{
      id: String(item.id).slice(0, 180),
      kind: item.kind === 'back' ? 'back' : 'feed',
      title: text.slice(0, 520),
      publishedAt: item.ts,
      observedAt: item.ts,
      platforms: [...platforms],
      links: links.map((link) => link.url),
    }]
  })
}

export function mergeHistory(previous, fresh, now) {
  const byId = new Map()
  for (const item of [...previous, ...fresh]) {
    if (item.observedAt > now - RETENTION_SECONDS) byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => b.observedAt - a.observedAt).slice(0, HISTORY_LIMIT)
}

async function fetchSource(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`VoucherSan returned HTTP ${response.status}`)
  return response
}

async function collectSource(key, now) {
  if (key === 'featured') {
    return parseFeatured(await (await fetchSource(SOURCE_URL)).text(), now)
  }
  return parseFeed(await (await fetchSource(FEED_URL)).json(), now)
}

async function syncSource(kv, key, now) {
  const previous = await kv.get(key, 'json')
  let fresh
  try {
    fresh = await collectSource(key, now)
  } catch (error) {
    const lastError = /^VoucherSan returned HTTP \d{3}$/.test(error.message)
      ? error.message : 'Không thể tải dữ liệu từ VoucherSan.'
    const failed = { records: [], ...previous, checkedAt: now, lastError }
    await kv.put(key, JSON.stringify(failed), { expirationTtl: RETENTION_SECONDS })
    throw error
  }
  const records = mergeHistory(previous?.records ?? [], fresh, now)
  const known = new Set((previous?.records ?? []).map(({ id }) => id))
  const newCount = records.filter(({ id }) => !known.has(id)).length
  await kv.put(key, JSON.stringify({ records, updatedAt: now, checkedAt: now, newCount }), { expirationTtl: RETENTION_SECONDS })
  console.info({ message: 'VoucherSan refreshed', source: key, received: fresh.length, stored: records.length })
}

function sourceStatus(snapshot) {
  return {
    lastSuccessAt: snapshot.updatedAt ?? null,
    lastAttemptAt: snapshot.checkedAt ?? snapshot.updatedAt ?? null,
    newCount: snapshot.newCount ?? null,
    lastError: snapshot.lastError ?? '',
  }
}

export default {
  async scheduled(_event, env) {
    const now = Math.floor(Date.now() / 1000)
    const results = await Promise.allSettled(
      ['featured', 'feed'].map((key) => syncSource(env.VOUCHER_HISTORY, key, now)),
    )
    const errors = results.filter((result) => result.status === 'rejected')
    if (errors.length) throw new AggregateError(errors.map((result) => result.reason), 'VoucherSan refresh failed')
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' }
    if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin
    const path = new URL(request.url).pathname
    if (path === '/voucher-alerts' || path.startsWith('/voucher-alerts/')) {
      if (request.method === 'OPTIONS' && headers['Access-Control-Allow-Origin']) {
        return new Response(null, { status: 204, headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        } })
      }
      return handleVoucherAlerts(request, env, headers)
    }
    if (request.method !== 'GET' || path !== '/vouchers') {
      return Response.json({ error: 'Not found' }, { status: 404, headers })
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return Response.json({ error: 'Origin not allowed' }, { status: 403, headers })
    }
    const now = Math.floor(Date.now() / 1000)
    const [featured, feed] = await Promise.all(
      ['featured', 'feed'].map(async (key) => {
        const stored = await env.VOUCHER_HISTORY.get(key, 'json')
        if (stored) return stored
        // Provide a read-only initial view while the first scheduled refresh propagates.
        try {
          return { records: await collectSource(key, now), updatedAt: now }
        } catch {
          return { records: [], updatedAt: null }
        }
      }),
    )
    return Response.json({
      featured: mergeHistory([], featured.records, now),
      feed: mergeHistory([], feed.records, now),
      featuredUpdatedAt: featured.updatedAt,
      feedUpdatedAt: feed.updatedAt,
      status: { featured: sourceStatus(featured), feed: sourceStatus(feed) },
    }, { headers })
  },
}
