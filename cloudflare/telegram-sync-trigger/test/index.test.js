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
