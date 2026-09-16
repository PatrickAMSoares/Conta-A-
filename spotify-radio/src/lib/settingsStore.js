const KEY = 'radio_settings_v1'

export const DEFAULT_SETTINGS = {
  sources: {
    savedTracks: true,
    topArtists: true,
    playlists: false,
    albums: false,
    discovery: false,
    popular: false,
  },
  familiaridade: 'equilibrado',
  variedade: 'media',
  repeticao: 'evitar',
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (!saved) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...saved, sources: { ...DEFAULT_SETTINGS.sources, ...saved.sources } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings))
}
