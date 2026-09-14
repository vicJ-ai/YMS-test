import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const app = express()
const rootDir = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 3000)
const itemGptBaseUrl = process.env.ITEMGPT_BASE_URL
const ymsBaseUrl = process.env.YMS_API_BASE_URL
const preferredTenant = process.env.YMS_DEFAULT_TENANT || 'LT'
const preferredYard = process.env.YMS_DEFAULT_YARD || 'LT_F1'
const preferredTimezone = process.env.YMS_DEFAULT_TIMEZONE || 'America/Los_Angeles'
const cookieName = '__Host-item_yms_session'
const sessions = new Map()
const loginAttempts = new Map()

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '24kb' }))

function publicError(res, status, message) {
  return res.status(status).json({ error: message })
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key))
}

function isSecureRequest(req) {
  return req.secure || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
}

function cookieAttributes(req) {
  return isSecureRequest(req) ? 'Secure; SameSite=None; Partitioned' : 'SameSite=Lax'
}

function setSessionCookie(req, res, id) {
  res.append('Set-Cookie', `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; ${cookieAttributes(req)}; Max-Age=28800`)
}

function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; ${cookieAttributes(req)}; Max-Age=0`)
}

function isSameOrigin(req) {
  const origin = req.get('origin')
  if (!origin) return true
  try {
    const originHost = new URL(origin).host
    const acceptedHosts = [req.get('host'), req.get('x-forwarded-host')].filter(Boolean)
    return acceptedHosts.includes(originHost)
  } catch {
    return false
  }
}

function requireSameOrigin(req, res, next) {
  if (!isSameOrigin(req)) return publicError(res, 403, 'This request could not be verified. Refresh the page and try again.')
  next()
}

function decodeIdentity(accessToken) {
  const payloadPart = accessToken?.split('.')[1]
  if (!payloadPart) throw new Error('invalid_token')
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
  const data = payload?.data || {}
  const userId = data.user_id
  const tenantId = data.tenant_id || data.company_code
  if (!userId || !tenantId) throw new Error('invalid_identity')
  return { userId: String(userId), tenantId: String(tenantId) }
}

function sessionView(session) {
  const profile = session.profile || {}
  const yards = Array.isArray(profile.yardList) ? profile.yardList.map((yard) => ({
    yardId: String(yard.yardId || ''),
    yardName: String(yard.yardName || 'Yard'),
    timezone: String(yard.timezone || preferredTimezone),
  })).filter((yard) => yard.yardId) : []
  return {
    authenticated: true,
    user: { name: String(profile.userName || 'Yard operator') },
    yards,
    activeYardId: session.yardId,
    activeYardName: yards.find((yard) => yard.yardId === session.yardId)?.yardName || 'Selected yard',
    timezone: session.timezone,
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { response, body }
}

async function loadProfile(accessToken, identity) {
  const { response, body } = await fetchJson(`${ymsBaseUrl}/user-profile/${encodeURIComponent(identity.userId)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Tenant-ID': identity.tenantId },
  })
  if (!response.ok || body?.success === false || !body?.data) throw new Error('profile_unavailable')
  return body.data
}

function chooseYard(profile) {
  const yards = Array.isArray(profile.yardList) ? profile.yardList : []
  const ids = new Set(yards.map((yard) => String(yard.yardId)))
  const yardId = [preferredYard, profile.defaultYardId, ...(profile.yardIds || [])].map(String).find((id) => ids.has(id)) || yards[0]?.yardId
  if (!yardId) throw new Error('no_yard_access')
  const yard = yards.find((item) => String(item.yardId) === String(yardId))
  return { yardId: String(yardId), timezone: String(yard?.timezone || preferredTimezone) }
}

async function refreshSession(session) {
  if (!session.refreshToken) return false
  const { response, body } = await fetchJson(`${itemGptBaseUrl}/api/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
  if (!response.ok || !body?.access_token) return false
  const identity = decodeIdentity(body.access_token)
  session.accessToken = body.access_token
  session.refreshToken = body.refresh_token || session.refreshToken
  session.userId = identity.userId
  session.tenantId = identity.tenantId
  session.expiresAt = Date.now() + Math.max(60, Number(body.expires_in || 3600) - 60) * 1000
  return true
}

function getSession(req) {
  const id = parseCookies(req.get('cookie'))[cookieName]
  const session = id ? sessions.get(id) : null
  return session ? { id, session } : null
}

async function requireSession(req, res, next) {
  const found = getSession(req)
  if (!found) return publicError(res, 401, 'Please sign in to continue.')
  if (found.session.expiresAt <= Date.now()) {
    try {
      if (!await refreshSession(found.session)) throw new Error('refresh_failed')
    } catch {
      sessions.delete(found.id)
      clearSessionCookie(req, res)
      return publicError(res, 401, 'Your session has ended. Please sign in again.')
    }
  }
  req.ymsSession = found.session
  next()
}

async function ymsRequest(session, endpoint, method = 'GET', body) {
  const request = async () => fetchJson(`${ymsBaseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': session.tenantId,
      'X-Yard-ID': session.yardId,
      'Item-Time-Zone': session.timezone,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let result = await request()
  if (result.response.status === 401 && await refreshSession(session)) result = await request()
  if (!result.response.ok || result.body?.success === false) {
    const error = new Error('yms_request_failed')
    error.status = result.response.status
    throw error
  }
  return result.body?.data ?? result.body ?? null
}

function pageRequest(body) {
  return {
    currentPage: Math.max(1, Math.floor(Number(body?.currentPage) || 1)),
    pageSize: Math.min(100, Math.max(1, Math.floor(Number(body?.pageSize) || 25))),
  }
}

app.get('/api/session', async (req, res) => {
  const found = getSession(req)
  if (!found) return res.json({ authenticated: false })
  try {
    if (found.session.expiresAt <= Date.now() && !await refreshSession(found.session)) throw new Error('refresh_failed')
    return res.json(sessionView(found.session))
  } catch {
    sessions.delete(found.id)
    clearSessionCookie(req, res)
    return res.json({ authenticated: false })
  }
})

app.post('/api/auth/login', requireSameOrigin, async (req, res) => {
  if (!itemGptBaseUrl || !ymsBaseUrl) return publicError(res, 503, 'Sign-in is not available in this deployment.')
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!username || !password || username.length > 254 || password.length > 512) return publicError(res, 400, 'Enter a valid username and password.')
  const key = req.ip || 'unknown'
  const attempt = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 60000 }
  if (attempt.resetAt < Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 60000 }
  if (attempt.count >= 8) return publicError(res, 429, 'Too many sign-in attempts. Please wait a moment and try again.')
  attempt.count += 1
  loginAttempts.set(key, attempt)
  try {
    const { response, body } = await fetchJson(`${itemGptBaseUrl}/api/auth/password-grant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, scope: 'openid', tenantId: preferredTenant }),
    })
    if (!response.ok || !body?.access_token) return publicError(res, 401, 'The username or password was not recognized.')
    const identity = decodeIdentity(body.access_token)
    const profile = await loadProfile(body.access_token, identity)
    const selected = chooseYard(profile)
    const id = crypto.randomBytes(32).toString('base64url')
    const session = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600) - 60) * 1000,
      userId: identity.userId,
      tenantId: identity.tenantId,
      profile,
      ...selected,
    }
    sessions.set(id, session)
    loginAttempts.delete(key)
    setSessionCookie(req, res, id)
    return res.json(sessionView(session))
  } catch {
    return publicError(res, 503, 'Sign-in is temporarily unavailable. Please try again.')
  }
})

app.post('/api/auth/logout', requireSameOrigin, (req, res) => {
  const found = getSession(req)
  if (found) sessions.delete(found.id)
  clearSessionCookie(req, res)
  res.json({ success: true })
})

app.post('/api/context/yard', requireSameOrigin, requireSession, (req, res) => {
  const yardId = typeof req.body?.yardId === 'string' ? req.body.yardId : ''
  const yards = Array.isArray(req.ymsSession.profile?.yardList) ? req.ymsSession.profile.yardList : []
  const yard = yards.find((item) => String(item.yardId) === yardId)
  if (!yard) return publicError(res, 403, 'That yard is not available for your account.')
  req.ymsSession.yardId = yardId
  req.ymsSession.timezone = String(yard.timezone || preferredTimezone)
  res.json(sessionView(req.ymsSession))
})

const pagedRoutes = {
  locations: '/location/search-by-paging',
  appointments: '/appointment/search-by-paging',
  gates: '/gate/search-by-paging',
  equipment: '/equipment-status/search-by-paging',
}

app.get('/api/yms/dashboard', requireSession, async (req, res) => {
  try { res.json({ data: await ymsRequest(req.ymsSession, '/dashboard/aggregate') }) }
  catch (error) { publicError(res, error.status === 403 ? 403 : 502, error.status === 403 ? 'Dashboard access is not available for this yard.' : 'Dashboard data is temporarily unavailable.') }
})

app.post('/api/yms/:resource', requireSameOrigin, requireSession, async (req, res) => {
  const endpoint = pagedRoutes[req.params.resource]
  if (!endpoint) return publicError(res, 404, 'This information is not available.')
  try { res.json({ data: await ymsRequest(req.ymsSession, endpoint, 'POST', pageRequest(req.body)) }) }
  catch (error) { publicError(res, error.status === 403 ? 403 : 502, error.status === 403 ? 'You do not have access to this information.' : 'This information is temporarily unavailable.') }
})

app.get('/api/yms/alerts/pending', requireSession, async (req, res) => {
  try { res.json({ data: await ymsRequest(req.ymsSession, '/equipment/alert/monitor/pending-tasks') }) }
  catch (error) { publicError(res, error.status === 403 ? 403 : 502, error.status === 403 ? 'Alert access is not available for this yard.' : 'Alerts are temporarily unavailable.') }
})

app.get('/api/yms/alerts/configuration', requireSession, async (req, res) => {
  try { res.json({ data: await ymsRequest(req.ymsSession, '/equipment-exceedance-alert-config/list') }) }
  catch (error) { publicError(res, error.status === 403 ? 403 : 502, error.status === 403 ? 'Alert settings are not available for this yard.' : 'Alert settings are temporarily unavailable.') }
})

app.use('/api', (_req, res) => publicError(res, 404, 'This request is not available.'))
app.use(express.static(path.join(rootDir, 'dist'), { etag: true, maxAge: '1h', index: false }))
app.get('*all', (_req, res) => res.sendFile(path.join(rootDir, 'dist', 'index.html')))

const cleanup = setInterval(() => {
  const staleBefore = Date.now() - 86400000
  for (const [id, session] of sessions) if (session.expiresAt < staleBefore) sessions.delete(id)
  for (const [key, attempt] of loginAttempts) if (attempt.resetAt < Date.now()) loginAttempts.delete(key)
}, 600000)
cleanup.unref()

app.listen(port, '0.0.0.0', () => console.log(`YMS application listening on 0.0.0.0:${port}`))
