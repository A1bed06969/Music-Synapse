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
