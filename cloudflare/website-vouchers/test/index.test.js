import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker, { mergeHistory, parseFeatured, parseFeed } from '../src/index.js'

const now = 1795062000
const day = 86400

test('extracts marketplace, amount, minimum and expiry from a featured card', () => {
  const html = '<li class="vsvc__item" data-tags="Tmall" data-hsd="2026-11-19">'
    + '<a href="https://s.lazada.vn/example?x=1&#038;y=2">'
    + '<span class="vsvc__big">80K</span><span class="vsvc__small">Đơn 0đ</span></a>'
    + '<p class="vsvc__title"><span class="vsvc__tags"><span>Label</span></span>Giảm 80K</p></li>'
  const [record] = parseFeatured(html, now)
  assert.equal(record.title, 'Giảm 80K')
  assert.equal(record.amount, '80K')
  assert.equal(record.minimumOrder, 'Đơn 0đ')
  assert.deepEqual(record.platforms, ['lazada'])
  assert.equal(record.links[0], 'https://s.lazada.vn/example?x=1&y=2')
  assert.equal(record.expiresAt, Date.parse('2026-11-19T23:59:59+07:00') / 1000)
})

test('maps public feed safely and keeps only five days without duplicates', () => {
  const html = '<b>Voucher 80K/0Đ</b> <a href="https://vouchersan.com/link/sh/?n=mahot">Mở</a>'
    + ' <a href="javascript:alert(1)">Khác</a>'
  const feed = parseFeed({
    items: [
      { id: 'active', ts: now - day, kind: 'back', html },
      { id: 'expired', ts: now - 5 * day, html },
      { id: 'unsafe', ts: now, html: '<a href="https://shopee.vn.attacker.example/">Click</a>' },
    ],
  }, now)
  assert.equal(feed.length, 1)
  assert.deepEqual(feed[0].platforms, ['shopee'])
  assert.deepEqual(feed[0].links, ['https://vouchersan.com/link/sh/?n=mahot'])
  assert.equal(feed[0].title, 'Voucher 80K/0Đ Mở Khác')
  assert.deepEqual(mergeHistory([
    { id: 'active', observedAt: now - day },
    { id: 'older', observedAt: now - 4 * day },
    { id: 'expired', observedAt: now - 5 * day },
  ], feed, now).map((record) => record.id), ['active', 'older'])
})

test('serves only public snapshot data and keeps the approved origin', async () => {
  const env = { VOUCHER_HISTORY: { get: async () => ({ updatedAt: now, records: [] }) } }
  const response = await worker.fetch(new Request('https://worker.example/vouchers', {
    headers: { Origin: 'https://shopeetung.web.app' },
  }), env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://shopeetung.web.app')
  const result = await response.json()
  assert.deepEqual(result.featured, [])
  assert.deepEqual(result.feed, [])
  assert.equal(result.status.feed.lastSuccessAt, now)
  assert.equal(result.status.featured.lastError, '')
  const write = await worker.fetch(new Request('https://worker.example/vouchers', { method: 'POST' }), env)
  assert.equal(write.status, 404)
})

test('scheduled snapshots preserve earlier entries when the source only returns the latest day', async (context) => {
  const saved = new Map()
  const time = Math.floor(Date.now() / 1000)
  const get = async (key) => key === 'feed'
    ? { records: [{ id: 'prior-day', observedAt: time - 2 * day }] }
    : null
  const put = async (key, value, options) => saved.set(key, { value: JSON.parse(value), options })
  context.mock.method(console, 'info', () => {})
  context.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('wp-json')) {
      return Response.json({ items: [{
        id: 'latest',
        ts: time,
        html: '<a href="https://s.shopee.vn/link">Giảm 100K/0Đ</a>',
      }] })
    }
    return new Response('<li class="vsvc__item"><a href="https://s.lazada.vn/link">'
      + '<span class="vsvc__big">80K</span></a></li>')
  })

  await worker.scheduled({}, { VOUCHER_HISTORY: { get, put } })
  assert.deepEqual(saved.get('feed').value.records.map((record) => record.id), ['latest', 'prior-day'])
  assert.equal(saved.get('featured').value.records.length, 1)
  assert.equal(saved.get('feed').options.expirationTtl, 5 * day)
})

test('retains the last good Website snapshot when VoucherSan is unavailable', async (context) => {
  const old = { records: [{ id: 'cached' }], updatedAt: now, newCount: 1 }
  const saved = new Map()
  const get = async () => old
  const put = async (key, value) => saved.set(key, JSON.parse(value))
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }))
  await assert.rejects(worker.scheduled({}, { VOUCHER_HISTORY: { get, put } }), /refresh failed/)
  assert.equal(saved.get('feed').lastError, 'VoucherSan returned HTTP 503')
  assert.equal(saved.get('feed').updatedAt, old.updatedAt)
  assert.deepEqual(saved.get('feed').records, old.records)
})
