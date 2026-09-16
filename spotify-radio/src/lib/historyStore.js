const KEY = 'radio_history_v1'
const MAX_ENTRIES = 200

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || []
  } catch {
    return []
  }
}

export function pushHistory(track) {
  const history = loadHistory()
  const entry = {
    id: track.id,
    name: track.name,
    artist: track.artists?.map((a) => a.name).join(', ') || 'Artista desconhecido',
    album: track.album?.name || '',
    image: track.album?.images?.[0]?.url || null,
    playedAt: new Date().toISOString(),
  }
  const updated = [entry, ...history].slice(0, MAX_ENTRIES)
  localStorage.setItem(KEY, JSON.stringify(updated))
  return updated
}

export function clearHistory() {
  localStorage.removeItem(KEY)
}
