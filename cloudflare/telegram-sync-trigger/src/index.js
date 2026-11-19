const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}
const statusKey = 'telegram:dispatch:latest'
const acceptedKey = 'telegram:dispatch:accepted'
const statusTtl = 7 * 24 * 60 * 60

function getAllowedOrigin(request, env) {
  const requestOrigin = request.headers.get('origin') || ''
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : ''
}

function responseJson(request, env, status, body) {
  const allowedOrigin = getAllowedOrigin(request, env)
  const headers = new Headers(jsonHeaders)
  if (allowedOrigin) {
    headers.set('access-control-allow-origin', allowedOrigin)
    headers.set('vary', 'Origin')
  }
  return new Response(JSON.stringify(body), { status, headers })
}

function getBearerToken(request) {
  const authorization = request.headers.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

async function getFirebaseUser(idToken, env) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  )
  if (!response.ok) return null

  const payload = await response.json()
  return Array.isArray(payload.users) ? payload.users[0] || null : null
}

function githubHeaders(env) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'content-type': 'application/json',
    'user-agent': 'shopee-telegram-sync-trigger',
    'x-github-api-version': '2022-11-28',
  }
}

function workflowApiUrl(env, suffix = '') {
  const owner = encodeURIComponent(env.GITHUB_OWNER)
  const repository = encodeURIComponent(env.GITHUB_REPOSITORY)
  const workflowId = encodeURIComponent(env.GITHUB_WORKFLOW_ID)
  return `https://api.github.com/repos/${owner}/${repository}/actions/workflows/${workflowId}${suffix}`
}

function githubFailure(response, error) {
  return {
    status: 502,
    body: {
      error,
      githubStatus: response.status,
      githubRequestId: response.headers.get('x-github-request-id') || '',
    },
  }
}

async function requestWorkflowRun(env) {
  const runsResponse = await fetch(workflowApiUrl(env, '/runs?per_page=10'), {
    headers: githubHeaders(env),
    signal: AbortSignal.timeout(15_000),
  })
  if (!runsResponse.ok) {
    return githubFailure(runsResponse, 'Không thể kiểm tra các lượt đồng bộ trên GitHub.')
  }

  const { workflow_runs: runs } = await runsResponse.json()
  if (!Array.isArray(runs)) throw new Error('GitHub không trả về danh sách lượt đồng bộ.')

  const activeRun = runs.find((run) => run.status !== 'completed')
  if (activeRun) {
    return {
      status: 409,
      body: {
        error: 'Một lượt đồng bộ đang chờ hoặc đang chạy.',
        runUrl: activeRun.html_url || '',
      },
    }
  }

  const dispatchResponse = await fetch(workflowApiUrl(env, '/dispatches'), {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({ ref: 'main' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!dispatchResponse.ok) {
    return githubFailure(dispatchResponse, 'GitHub từ chối yêu cầu chạy workflow.')
  }

  return {
    status: 202,
    body: { message: 'Đã gửi yêu cầu đồng bộ tới GitHub Actions.' },
  }
}

async function dispatchAndRecord(env, source) {
  let result
  try {
    result = await requestWorkflowRun(env)
  } catch {
    result = { status: 502, body: { error: 'Không thể kết nối GitHub Actions.' } }
  }
  const at = Date.now()
  const outcome = result.status === 202 ? 'sent' : result.status === 409 ? 'skipped' : 'failed'
  if (env.SYNC_STATUS) {
    try {
      const status = { at, source, outcome, error: outcome === 'failed' ? result.body.error : '' }
      const writes = [env.SYNC_STATUS.put(statusKey, JSON.stringify(status), { expirationTtl: statusTtl })]
      if (outcome === 'sent') writes.push(env.SYNC_STATUS.put(acceptedKey, JSON.stringify(at), { expirationTtl: statusTtl }))
      await Promise.all(writes)
    } catch {
      console.warn('Không thể lưu trạng thái Cloudflare Telegram.')
    }
  }
  return result
}

async function latestRunStatus(env) {
  const response = await fetch(workflowApiUrl(env, '/runs?branch=main&per_page=1'), {
    headers: githubHeaders(env),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error('Không đọc được trạng thái GitHub Actions.')
  const { workflow_runs: runs } = await response.json()
  const run = runs?.[0]
  return run ? {
    id: run.id, createdAt: run.created_at, status: run.status, conclusion: run.conclusion, url: run.html_url,
  } : null
}

async function handleRequest(request, env, readStatus) {
  if (!getAllowedOrigin(request, env)) {
    return responseJson(request, env, 403, { error: 'Nguồn gửi yêu cầu không được phép.' })
  }

  const idToken = getBearerToken(request)
  if (!idToken || idToken.length > 10_000) {
    return responseJson(request, env, 401, { error: 'Phiên đăng nhập không hợp lệ.' })
  }

  const firebaseUser = await getFirebaseUser(idToken, env)
  const userEmail = String(firebaseUser?.email || '').toLocaleLowerCase('en')
  if (!firebaseUser || firebaseUser.disabled || userEmail !== String(env.ALLOWED_EMAIL).toLocaleLowerCase('en')) {
    return responseJson(request, env, 403, { error: 'Tài khoản không có quyền chạy đồng bộ.' })
  }

  if (readStatus) {
    const [dispatch, acceptedAt, github] = await Promise.allSettled([
      env.SYNC_STATUS?.get(statusKey, 'json'),
      env.SYNC_STATUS?.get(acceptedKey, 'json'),
      latestRunStatus(env),
    ])
    return responseJson(request, env, 200, {
      dispatch: dispatch.value ?? null,
      acceptedAt: acceptedAt.value ?? null,
      github: github.value ?? null,
      githubError: github.status === 'rejected' ? 'Không đọc được trạng thái GitHub Actions.' : '',
    })
  }

  const result = await dispatchAndRecord(env, 'manual')
  return responseJson(request, env, result.status, result.body)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      const allowedOrigin = getAllowedOrigin(request, env)
      if (!allowedOrigin) return new Response(null, { status: 403 })
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': allowedOrigin,
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-max-age': '86400',
          vary: 'Origin',
        },
      })
    }

    const readStatus = url.pathname === '/status' && request.method === 'GET'
    if (!readStatus && (url.pathname !== '/trigger' || request.method !== 'POST')) {
      return responseJson(request, env, 404, { error: 'Không tìm thấy endpoint.' })
    }

    try {
      return await handleRequest(request, env, readStatus)
    } catch {
      return responseJson(request, env, 500, { error: 'Không thể gửi yêu cầu đồng bộ.' })
    }
  },

  async scheduled(controller, env) {
    const result = await dispatchAndRecord(env, 'schedule')
    if (result.status === 502) {
      const { error, githubStatus, githubRequestId } = result.body
      throw new Error(`${error} HTTP ${githubStatus} (${githubRequestId || 'không có mã yêu cầu'})`)
    }

    console.info({
      message: result.body.message || result.body.error,
      outcome: result.status === 202 ? 'dispatched' : 'skipped',
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
    })
  },
}
