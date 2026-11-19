const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

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

async function getLatestWorkflowRun(env) {
  const response = await fetch(workflowApiUrl(env, '/runs?per_page=1'), {
    headers: githubHeaders(env),
  })
  if (!response.ok) return null

  const payload = await response.json()
  return Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] || null : null
}

async function dispatchWorkflow(env) {
  return fetch(workflowApiUrl(env, '/dispatches'), {
    method: 'POST',
    headers: githubHeaders(env),
    body: JSON.stringify({ ref: 'main' }),
  })
}

async function handleTrigger(request, env) {
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

  const latestRun = await getLatestWorkflowRun(env)
  if (latestRun && ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(latestRun.status)) {
    return responseJson(request, env, 409, {
      error: 'Một lượt đồng bộ đang chờ hoặc đang chạy.',
      runUrl: latestRun.html_url || '',
    })
  }

  const dispatchResponse = await dispatchWorkflow(env)
  if (!dispatchResponse.ok) {
    const githubRequestId = dispatchResponse.headers.get('x-github-request-id') || ''
    return responseJson(request, env, 502, {
      error: 'GitHub từ chối yêu cầu chạy workflow.',
      githubStatus: dispatchResponse.status,
      githubRequestId,
    })
  }

  return responseJson(request, env, 202, {
    message: 'Đã gửi yêu cầu đồng bộ tới GitHub Actions.',
  })
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
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-max-age': '86400',
          vary: 'Origin',
        },
      })
    }

    if (url.pathname !== '/trigger' || request.method !== 'POST') {
      return responseJson(request, env, 404, { error: 'Không tìm thấy endpoint.' })
    }

    try {
      return await handleTrigger(request, env)
    } catch {
      return responseJson(request, env, 500, { error: 'Không thể gửi yêu cầu đồng bộ.' })
    }
  },
}
