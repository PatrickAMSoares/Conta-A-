import { API_BASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from './config'
import { RadioError, ERROR_MESSAGES } from './errors'

const STATE_KEY = 'spotify_auth_state'

export function buildAuthorizeUrl() {
  const state = crypto.randomUUID()
  sessionStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    state,
    show_dialog: 'true',
  })
  return `https://accounts.spotify.com/authorize?${params.toString()}`
}

export function consumeAuthState(returnedState) {
  const saved = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  return Boolean(saved) && saved === returnedState
}

async function postJson(path, body) {
  let res
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new RadioError('API_UNAVAILABLE', ERROR_MESSAGES.API_UNAVAILABLE)
  }
  if (!res.ok) throw new RadioError('AUTH_FAILED', ERROR_MESSAGES.AUTH_FAILED)
  return res.json()
}

export function exchangeCodeForSession(code) {
  return postJson('/exchangeToken', { code, redirectUri: SPOTIFY_REDIRECT_URI })
}

export function refreshSession(sessionId) {
  return postJson('/refreshToken', { sessionId }).catch(() => {
    throw new RadioError('TOKEN_EXPIRED', ERROR_MESSAGES.TOKEN_EXPIRED)
  })
}

export async function endSession(sessionId) {
  if (!sessionId) return
  await fetch(`${API_BASE_URL}/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => {})
}
