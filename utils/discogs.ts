// Discogs API client. Read-only usage via a personal access token
// (no OAuth flow needed) — see https://www.discogs.com/settings/developers
// Rate limit: 60 req/min authenticated. A single admin-triggered credits
// import stays well under that without help, but the bulk backfill script
// (scripts/bulk-import-credits.ts) issues far more requests, so every call
// is throttled here to stay safely under the limit.

const DISCOGS_BASE = 'https://api.discogs.com'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'
const MIN_REQUEST_INTERVAL_MS = 600 // 60req/min上限に対して十分な余裕を持たせる

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function authHeaders(): Record<string, string> {
  const token = process.env.DISCOGS_TOKEN
  if (!token) {
    throw new Error('DISCOGS_TOKENが設定されていません。')
  }
  return {
    Authorization: `Discogs token=${token}`,
    'User-Agent': USER_AGENT,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDiscogs(url: string, label: string): Promise<any> {
  await sleep(MIN_REQUEST_INTERVAL_MS)
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    throw new Error(`Discogs API error (${label}): ${res.status}`)
  }
  return res.json()
}

export type DiscogsReleaseSearchResult = {
  discogsId: number
  title: string
  year: string | null
  country: string | null
  format: string | null
}

export async function searchRelease(title: string, artistName: string): Promise<DiscogsReleaseSearchResult[]> {
  const params = new URLSearchParams({
    type: 'release',
    release_title: title,
    artist: artistName,
  })
  const data = await fetchDiscogs(`${DISCOGS_BASE}/database/search?${params}`, 'release search')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).slice(0, 5).map((r: any) => ({
    discogsId: r.id,
    title: r.title,
    year: r.year ?? null,
    country: r.country ?? null,
    format: Array.isArray(r.format) ? r.format.join(' / ') : null,
  }))
}

export type DiscogsReleaseCredit = {
  personName: string
  personDiscogsId: string
  role: 'producer' | 'mix' | 'mastering' | 'composer' | 'lyricist' | 'arranger' | 'artwork' | 'musician'
  sourceUrl: string
  trackTitle: string | null
  instrumentName?: string
}

// Discogsのrole表記(自由入力に近く、括弧で補足が付くことがある。
// 例: "Illustration [Tongue Illustration]")を、既存7ロール+musicianへ
// マッピングする許可リスト方式。未対応の役割(Engineer/Photography By等)は
// MusicBrainz側の方針と同様に取り込み対象外とする。
const ROLE_MAP: Record<string, DiscogsReleaseCredit['role']> = {
  producer: 'producer',
  'co-producer': 'producer',
  'executive-producer': 'producer',
  'mixed by': 'mix',
  'mastered by': 'mastering',
  'written-by': 'composer',
  'music by': 'composer',
  'lyrics by': 'lyricist',
  'arranged by': 'arranger',
  'artwork by': 'artwork',
  design: 'artwork',
  illustration: 'artwork',
}

// 演奏楽器としてよく現れる役割名(MusicBrainz側のINSTRUMENT_NAME_JAと表記を揃える)
const INSTRUMENT_ROLE_JA: Record<string, string> = {
  drums: 'ドラム',
  bass: 'ベース',
  'bass guitar': 'ベース',
  'electric bass guitar': 'ベース',
  'electric upright bass': 'ウッドベース',
  'double bass': 'ウッドベース',
  horn: 'ホルン',
  'french horn': 'ホルン',
  'hammond organ': 'オルガン',
  guitar: 'ギター',
  'electric guitar': 'エレキギター',
  'acoustic guitar': 'アコースティックギター',
  synthesizer: 'シンセサイザー',
  piano: 'ピアノ',
  keyboards: 'キーボード',
  organ: 'オルガン',
  tambourine: 'タンバリン',
  percussion: 'パーカッション',
  saxophone: 'サックス',
  trumpet: 'トランペット',
  trombone: 'トロンボーン',
  violin: 'バイオリン',
  cello: 'チェロ',
  flute: 'フルート',
  clarinet: 'クラリネット',
  harmonica: 'ハーモニカ',
  banjo: 'バンジョー',
  ukulele: 'ウクレレ',
  strings: 'ストリングス',
  brass: 'ブラス',
  vocals: 'ボーカル',
  'backing vocals': 'コーラス',
}

function normalizeRole(rawRole: string): string {
  // "Illustration [Tongue Illustration]" -> "illustration"
  return rawRole.split('[')[0].trim().toLowerCase()
}

// tracksフィールド(例: "", "17", "1 to 16", "1, 3 to 5")をトラック番号の配列に展開する。
// 空文字はリリース全体を意味するので空配列を返す(呼び出し側でalbum-wide扱いにする)。
function expandTrackPositions(tracksField: string): string[] {
  const trimmed = tracksField.trim()
  if (!trimmed) return []

  const positions: string[] = []
  for (const part of trimmed.split(',')) {
    const segment = part.trim()
    const rangeMatch = segment.match(/^(\d+)\s+to\s+(\d+)$/i)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      for (let n = start; n <= end; n++) positions.push(String(n))
      continue
    }
    if (segment) positions.push(segment)
  }
  return positions
}

export type DiscogsReleaseCreditsResult = {
  credits: DiscogsReleaseCredit[]
}

export async function fetchReleaseCredits(discogsReleaseId: number): Promise<DiscogsReleaseCreditsResult> {
  const sourceUrl = `https://www.discogs.com/release/${discogsReleaseId}`
  const data = await fetchDiscogs(`${DISCOGS_BASE}/releases/${discogsReleaseId}`, 'release credits')

  const titleByPosition = new Map<string, string>()
  for (const track of data.tracklist ?? []) {
    if (track.position && track.title) titleByPosition.set(String(track.position), track.title)
  }

  const credits: DiscogsReleaseCredit[] = []
  const seen = new Set<string>()

  function addCredit(personDiscogsId: string, personName: string, role: DiscogsReleaseCredit['role'], trackTitle: string | null, instrumentName?: string) {
    const key = `${personDiscogsId}:${role}:${trackTitle ?? ''}:${instrumentName ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    credits.push({ personName, personDiscogsId, role, sourceUrl, trackTitle, instrumentName })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extraartists: any[] = data.extraartists ?? []

  for (const ea of extraartists) {
    if (!ea.id || !ea.name) continue
    const normalized = normalizeRole(ea.role ?? '')
    const positions = expandTrackPositions(ea.tracks ?? '')
    const trackTitles = positions.length > 0 ? positions.map((p) => titleByPosition.get(p)).filter((t): t is string => Boolean(t)) : [null]

    const mappedRole = ROLE_MAP[normalized]
    if (mappedRole) {
      for (const trackTitle of trackTitles) {
        addCredit(String(ea.id), ea.name, mappedRole, trackTitle)
      }
      continue
    }

    const instrumentJa = INSTRUMENT_ROLE_JA[normalized]
    if (instrumentJa) {
      for (const trackTitle of trackTitles) {
        addCredit(String(ea.id), ea.name, 'musician', trackTitle, instrumentJa)
      }
    }
  }

  return { credits }
}
