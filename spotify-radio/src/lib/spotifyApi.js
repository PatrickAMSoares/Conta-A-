const BASE = 'https://api.spotify.com/v1'

async function request(token, path, { method = 'GET', body, params } = {}) {
  const url = new URL(BASE + path)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, value)
    })
  }

  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    const err = new Error('network_error')
    err.status = 0
    throw err
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') || 1)
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))
    return request(token, path, { method, body, params })
  }
  if (res.status === 204) return null
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    const err = new Error(payload?.error?.message || `Spotify API error ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

export const spotifyApi = {
  getMe: (token) => request(token, '/me'),
  getSavedTracks: (token, limit = 50) => request(token, '/me/tracks', { params: { limit } }),
  getTopTracks: (token, timeRange = 'medium_term', limit = 50) =>
    request(token, '/me/top/tracks', { params: { time_range: timeRange, limit } }),
  getTopArtists: (token, timeRange = 'medium_term', limit = 50) =>
    request(token, '/me/top/artists', { params: { time_range: timeRange, limit } }),
  getPlaylists: (token, limit = 50) => request(token, '/me/playlists', { params: { limit } }),
  getPlaylistTracks: (token, playlistId, limit = 50) =>
    request(token, `/playlists/${playlistId}/tracks`, { params: { limit } }),
  getSavedAlbums: (token, limit = 50) => request(token, '/me/albums', { params: { limit } }),
  getAlbumTracks: (token, albumId, limit = 50) => request(token, `/albums/${albumId}/tracks`, { params: { limit } }),
  getFollowedArtists: (token, limit = 50) =>
    request(token, '/me/following', { params: { type: 'artist', limit } }),
  getArtistTopTracks: (token, artistId) => request(token, `/artists/${artistId}/top-tracks`),
  getNewReleases: (token, limit = 50) => request(token, '/browse/new-releases', { params: { limit } }),
  getRecentlyPlayed: (token, limit = 50) => request(token, '/me/player/recently-played', { params: { limit } }),
  play: (token, deviceId, uris) =>
    request(token, '/me/player/play', { method: 'PUT', params: { device_id: deviceId }, body: { uris } }),
  pause: (token, deviceId) => request(token, '/me/player/pause', { method: 'PUT', params: { device_id: deviceId } }),
  resume: (token, deviceId) => request(token, '/me/player/play', { method: 'PUT', params: { device_id: deviceId } }),
}
