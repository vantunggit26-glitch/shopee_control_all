import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.js'

const env = {
  ALLOWED_ORIGINS: 'https://shopeetung.web.app,http://localhost:5173',
  ALLOWED_EMAIL: 'tungtv@account.com',
  FIREBASE_WEB_API_KEY: 'public-key',
  GITHUB_OWNER: 'owner',
  GITHUB_REPOSITORY: 'repository',
  GITHUB_WORKFLOW_ID: 'workflow.yml',
  GITHUB_TOKEN: 'secret-token',
}
const scheduledEvent = { scheduledTime: Date.parse('2026-11-19T03:47:00Z') }

function triggerRequest(token = 'firebase-token') {
  return new Request('https://worker.example/trigger', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'https://shopeetung.web.app',
    },
  })
}

test('rejects requests without a Firebase ID token', async () => {
  const response = await worker.fetch(triggerRequest(''), env)
  assert.equal(response.status, 401)
})

test('rejects a signed-in user who is not the configured administrator', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => Response.json({ users: [{ email: 'other@example.com' }] })

  const response = await worker.fetch(triggerRequest(), env)
  assert.equal(response.status, 403)
})

test('does not queue another run while the workflow is running', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  let requestCount = 0
  globalThis.fetch = async () => {
    requestCount += 1
    if (requestCount === 1) return Response.json({ users: [{ email: env.ALLOWED_EMAIL }] })
    return Response.json({ workflow_runs: [{ status: 'in_progress', html_url: 'https://github.test/run' }] })
  }

  const response = await worker.fetch(triggerRequest(), env)
  assert.equal(response.status, 409)
  assert.equal(requestCount, 2)
})

test('dispatches the workflow for the configured administrator', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (requests.length === 1) return Response.json({ users: [{ email: env.ALLOWED_EMAIL }] })
    if (requests.length === 2) return Response.json({ workflow_runs: [{ status: 'completed' }] })
    return new Response(null, { status: 204 })
  }

  const response = await worker.fetch(triggerRequest(), env)
  assert.equal(response.status, 202)
  assert.equal(requests.length, 3)
  assert.match(requests[2].url, /\/dispatches$/)
  assert.equal(requests[2].options.method, 'POST')
  assert.equal(requests[2].options.headers.authorization, `Bearer ${env.GITHUB_TOKEN}`)
})

test('dispatches to main directly from the Cloudflare schedule', async (context) => {
  const requests = []
  context.mock.method(console, 'info', () => {})
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    if (requests.length === 1) return Response.json({ workflow_runs: [] })
    return new Response(null, { status: 204 })
  })

  await worker.scheduled(scheduledEvent, env)

  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /^https:\/\/api\.github\.com\/.*\/runs\?/)
  assert.match(requests[1].url, /\/dispatches$/)
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(requests[1].options.headers.authorization, `Bearer ${env.GITHUB_TOKEN}`)
  assert.deepEqual(JSON.parse(requests[1].options.body), { ref: 'main' })
})

test('skips the schedule when an earlier run is still queued', async (context) => {
  const log = context.mock.method(console, 'info', () => {})
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => Response.json({
    workflow_runs: [{ status: 'completed' }, { status: 'queued' }],
  }))

  await worker.scheduled(scheduledEvent, env)

  assert.equal(fetchMock.mock.callCount(), 1)
  assert.equal(log.mock.calls[0].arguments[0].outcome, 'skipped')
})

test('fails the scheduled invocation if GitHub rejects the status check', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(null, {
    status: 401,
    headers: { 'x-github-request-id': 'request-id' },
  }))

  await assert.rejects(worker.scheduled(scheduledEvent, env), /HTTP 401 \(request-id\)/)
  assert.equal(fetchMock.mock.callCount(), 1)
})
