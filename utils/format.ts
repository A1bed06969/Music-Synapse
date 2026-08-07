export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '未定'
  const [y, m, d] = dateStr.split('-')
  return `${y}.${m}.${d}`
}

export const STREAMING_STATUS_LABEL: Record<string, { label: string; icon: string }> = {
  all: { label: '全配信中', icon: '🟢' },
  apple_only: { label: 'Apple Music限定', icon: '🍏' },
  none: { label: '配信なし', icon: '🔴' },
}

export const ARTIST_STREAMING_STATUS_LABEL: Record<string, string> = {
  available: 'あり',
  none: 'なし',
}

export const ARTIST_TYPE_LABEL: Record<string, string> = {
  solo: 'ソロ',
  band: 'バンド',
  unit: 'ユニット',
}

export function extractYoutubeVideoId(url: string): string | null {
  const isValidId = (candidate: string | null): candidate is string =>
    candidate !== null && /^[\w-]{11}$/.test(candidate)

  const trimmed = url.trim()
  if (isValidId(trimmed)) return trimmed

  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1) || null
      return isValidId(id) ? id : null
    }
    if (parsed.hostname.endsWith('youtube.com')) {
      const v = parsed.searchParams.get('v')
      if (v) return isValidId(v) ? v : null
      const embedMatch = parsed.pathname.match(/^\/embed\/([^/]+)/)
      if (embedMatch) return isValidId(embedMatch[1]) ? embedMatch[1] : null
    }
    return null
  } catch {
    return null
  }
}

export function extractSpotifyTrackId(input: string): string | null {
  const isValidId = (candidate: string): boolean => /^[0-9A-Za-z]{22}$/.test(candidate)

  const trimmed = input.trim()
  if (isValidId(trimmed)) return trimmed

  const uriMatch = trimmed.match(/^spotify:track:([0-9A-Za-z]{22})$/)
  if (uriMatch) return isValidId(uriMatch[1]) ? uriMatch[1] : null

  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname === 'open.spotify.com') {
      const pathMatch = parsed.pathname.match(/\/track\/([0-9A-Za-z]{22})/)
      if (pathMatch) return isValidId(pathMatch[1]) ? pathMatch[1] : null
    }
    return null
  } catch {
    return null
  }
}
