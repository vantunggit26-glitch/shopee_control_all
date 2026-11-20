import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import worker from '../src/index.js'

const api = 'https://worker.example/voucher-alerts'
const origin = 'https://shopeetung.web.app'
const project = 'account-vault-tung'

function idToken(uid, audience = project) {
  return 'header.' + Buffer.from(JSON.stringify({
    sub: uid, aud: audience, iss: `https://securetoken.google.com/${audience}`,
    exp: Date.now() / 1000 + 3600,
  })).toString('base64url') + '.signature'
}

function setup(context) {
  const records = new Map()
  const env = {
    FIREBASE_PROJECT_ID: project,
    FIREBASE_WEB_API_KEY: 'test-api-key',
    VOUCHER_HISTORY: { get: async (key) => records.get(key), put: async (key, json) => records.set(key, JSON.parse(json)) },
  }
  const tokens = new Map(['owner', 'other'].map(uid => [idToken(uid), uid]))
  // Use the issued test strings; every other token is rejected by the mock verifier.
  const owner = [...tokens.keys()][0]
  const other = [...tokens.keys()][1]
  const auth = context.mock.method(globalThis, 'fetch', async (_url, options) => {
    const uid = tokens.get(JSON.parse(options.body).idToken)
    return uid ? Response.json({ users: [{ localId: uid }] }) : Response.json({}, { status: 400 })
  })
  const request = (path = '', token = owner, method = 'GET', body, requestOrigin = origin) => (
    worker.fetch(new Request(api + path, {
      method,
      headers: { ...(requestOrigin && { Origin: requestOrigin }), ...(token && { Authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }), env)
  )
  return { request, records, auth, owner, other }
}

const settings = { keyword: 'Mã người mới giảm', emails: ['user@gmail.com'], enabled: true }

test('checks Firebase identity, website origin, and exposes no private settings across accounts', async (context) => {
  const { request, owner, other, auth, records } = setup(context)
  assert.equal((await request('', '')).status, 401)
  assert.equal((await request('', owner, 'GET', undefined, 'https://untrusted.example')).status, 403)
  assert.equal((await request('', idToken('owner', 'wrong-firebase-project'))).status, 401)
  assert.equal(auth.mock.callCount(), 0)
  assert.equal((await request('', owner + '-modified')).status, 401)
  assert.equal((await request('', owner, 'PUT', settings)).status, 200)
  assert.deepEqual(await (await request('', other)).json(), { settings: null })
  assert.equal(records.size, 1)
})

test('creates, edits and rotates a scoped read-only runner token', async (context) => {
  const { request, owner, other, records } = setup(context)
  const created = await (await request('', owner, 'PUT', {
    ...settings, emails: [' user@gmail.com ', 'USER@googlemail.com', 'two@gmail.com'],
  })).json()
  assert.deepEqual(created.settings.emails, ['user@gmail.com', 'two@gmail.com'])
  assert.match(created.connectionCode, /^owner\.[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify([...records.values()]).includes(created.connectionCode.split('.')[1]))

  const read = await (await request('')).json()
  assert.deepEqual(read, { settings: created.settings })
  const runner = async (token) => request('/runner', token, 'GET', undefined, '')
  assert.deepEqual(await (await runner(created.connectionCode)).json(), read)
  assert.equal((await runner(created.connectionCode.replace('owner.', 'other.'))).status, 401)
  assert.equal((await request('', created.connectionCode, 'PUT', settings)).status, 401)

  const updated = await (await request('', owner, 'PUT', { ...settings, enabled: false })).json()
  assert.equal(updated.settings.enabled, false)
  assert.equal(updated.connectionCode, undefined)
  assert.deepEqual(await (await runner(created.connectionCode)).json(), updated)
  const rotated = await (await request('/connect', owner, 'POST')).json()
  assert.notEqual(rotated.connectionCode, created.connectionCode)
  assert.equal((await runner(created.connectionCode)).status, 401)
  assert.deepEqual(await (await runner(rotated.connectionCode)).json(), updated)
  assert.equal((await request('/connect', other, 'POST')).status, 409)
})

test('rejects invalid, excessive and oversized settings', async (context) => {
  const { request, owner, records } = setup(context)
  for (const invalid of [
    { ...settings, keyword: '  ' }, { ...settings, emails: ['other@example.com'] },
    { ...settings, emails: Array.from({ length: 11 }, (_, index) => `${index}@gmail.com`) },
    'x'.repeat(5000),
  ]) {
    assert.equal((await request('', owner, 'PUT', invalid)).status, 400)
  }
  assert.equal(records.size, 0)
})
