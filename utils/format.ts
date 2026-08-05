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
  all: '全解禁確定',
  physical_only: 'フィジカルのみ',
  partial: '一部限定配信',
}

export const ARTIST_TYPE_LABEL: Record<string, string> = {
  solo: 'ソロ',
  band: 'バンド',
  unit: 'ユニット',
}

export function extractYoutubeVideoId(url: string): string | null {
  const isValidId = (candidate: string | null): candidate is string =>
    candidate !== null && /^[\w-]{11}$/.test(candidate)

  try {
    const parsed = new URL(url)
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
