import { timingSafeEqual } from 'node:crypto'

const encoder = new TextEncoder()
const uidPattern = /^[A-Za-z0-9_-]{1,128}$/
const gmailPattern = /^[\w.+-]+@(?:gmail|googlemail)\.com$/i
const maxRecipients = 10

function bearerToken(request) {
  return /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') || '')?.[1] || ''
}

async function accountUid(token, env) {
  if (!token || token.length > 10000) return ''
  let claims
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (byte) => byte.charCodeAt(0))))
  } catch {
    return ''
  }
  if (!claims || claims.aud !== env.FIREBASE_PROJECT_ID
    || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
    || typeof claims.sub !== 'string' || !uidPattern.test(claims.sub)
    || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000
    || claims.firebase?.sign_in_provider === 'anonymous') return ''

  // Claims above are only a precheck. Firebase authenticates the signed token.
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
    signal: AbortSignal.timeout(8000),
  })
  if (response.status === 400 || response.status === 401 || response.status === 403) return ''
  if (!response.ok) throw new Error('Firebase authentication unavailable')
  const { users } = await response.json()
  const user = users?.[0]
  return user?.localId === claims.sub && !user.disabled ? claims.sub : ''
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function tokenHash(secret) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret))))
}

function settingsKey(uid) {
  return `website-alert:v1:${uid}`
}

function publicSettings(settings) {
  if (!settings) return null
  const { keyword, emails, enabled, startsAt } = settings
  return { keyword, emails, enabled, startsAt }
}

async function readSettings(request) {
  if (!request.body || Number(request.headers.get('Content-Length')) > 4096) return null
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4096) {
        await reader.cancel()
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function normalizeSettings(input) {
  if (typeof input?.keyword !== 'string' || !Array.isArray(input.emails)
    || typeof input.enabled !== 'boolean' || input.emails.length > maxRecipients
    || input.emails.some((email) => typeof email !== 'string')) return null
  const keyword = input.keyword.normalize('NFKC').trim().replace(/\s+/g, ' ')
  const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()
    .replace(/@googlemail\.com$/, '@gmail.com')))]
  if (keyword.length < 3 || keyword.length > 120 || !emails.length
    || emails.some((email) => email.length > 254 || !gmailPattern.test(email))) return null
  return { keyword, emails, enabled: input.enabled }
}

export async function handleVoucherAlerts(request, env, headers) {
  const path = new URL(request.url).pathname
  const origin = request.headers.get('Origin')
  const reply = (body, status = 200) => Response.json(body, { status, headers })
  const fail = (error, status) => reply({ error }, status)
  const token = bearerToken(request)

  try {
    if (path === '/voucher-alerts/runner' && request.method === 'GET') {
      const match = /^([A-Za-z0-9_-]{1,128})\.([a-f0-9]{64})$/.exec(token)
      if (!match) return fail('Mã kết nối không hợp lệ.', 401)
      const [, uid, secret] = match
      const settings = await env.VOUCHER_HISTORY.get(settingsKey(uid), 'json')
      if (!settings || !/^[a-f0-9]{64}$/.test(settings.tokenHash)
        || !timingSafeEqual(encoder.encode(settings.tokenHash), encoder.encode(await tokenHash(secret)))) {
        return fail('Mã kết nối không hợp lệ hoặc đã được cấp lại.', 401)
      }
      return reply({ settings: publicSettings(settings) })
    }

    const isSettings = path === '/voucher-alerts' && ['GET', 'PUT'].includes(request.method)
    const isRotate = path === '/voucher-alerts/connect' && request.method === 'POST'
    if (!isSettings && !isRotate) return fail('Không tìm thấy chức năng này.', 404)
    if (!origin || !headers['Access-Control-Allow-Origin']) return fail('Nguồn yêu cầu không được phép.', 403)
    const uid = await accountUid(token, env)
    if (!uid) return fail('Phiên đăng nhập không hợp lệ. Hãy đăng nhập lại.', 401)
    const key = settingsKey(uid)
    const old = await env.VOUCHER_HISTORY.get(key, 'json')

    if (request.method === 'GET') return reply({ settings: publicSettings(old) })
    if (isRotate && !old) return fail('Hãy lưu thông báo trước khi tạo mã kết nối.', 409)
    const input = isRotate ? publicSettings(old) : normalizeSettings(await readSettings(request))
    if (!input) return fail('Nhập từ khóa từ 3–120 ký tự và từ 1–10 địa chỉ Gmail hợp lệ.', 400)

    const changed = !old || old.enabled !== input.enabled || old.keyword !== input.keyword
      || [...old.emails].sort().join(',') !== [...input.emails].sort().join(',')
    if (!changed && !isRotate) return reply({ settings: publicSettings(old) })
    const secret = !old || isRotate ? hex(crypto.getRandomValues(new Uint8Array(32))) : ''
    const settings = {
      ...input,
      startsAt: changed ? Math.ceil(Date.now() / 1000) : old.startsAt,
      tokenHash: secret ? await tokenHash(secret) : old.tokenHash,
    }
    await env.VOUCHER_HISTORY.put(key, JSON.stringify(settings))
    return reply({
      settings: publicSettings(settings),
      ...(secret && { connectionCode: `${uid}.${secret}` }),
    })
  } catch {
    return fail('Chưa thể truy cập cấu hình thông báo. Hãy thử lại sau.', 503)
  }
}
