export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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
  // Apple Musicで見つからず(検索で候補なし)、Tower Records等から手がかりのみ
  // 登録した作品用。「配信なし」(none, 配信終了・非公開など理由を問わない)とは
  // 区別し、権利者の意向でサブスク非解禁になっている旧譜であることを示す。
  unreleased: { label: 'サブスク未解禁', icon: '' },
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

export const CREDIT_ROLE_LABEL: Record<string, string> = {
  producer: 'プロデューサー',
  mix: 'ミックス',
  mastering: 'マスタリング',
  composer: '作曲',
  lyricist: '作詞',
  arranger: '編曲',
  artwork: 'アートワーク',
  musician: 'ミュージシャン',
}

// role別のバッジ色分け(ダーク背景向けに、枠線+文字色だけ変えた控えめな配色)
export const CREDIT_ROLE_COLOR: Record<string, string> = {
  producer: 'border-amber-400/40 text-amber-300',
  mix: 'border-sky-400/40 text-sky-300',
  mastering: 'border-violet-400/40 text-violet-300',
  composer: 'border-emerald-400/40 text-emerald-300',
  lyricist: 'border-rose-400/40 text-rose-300',
  arranger: 'border-cyan-400/40 text-cyan-300',
  artwork: 'border-orange-400/40 text-orange-300',
  musician: 'border-indigo-400/40 text-indigo-300',
}
