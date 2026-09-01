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

export type DiscogsArtistSearchResult = {
  discogsId: number
  name: string
}

/**
 * アーティスト名でDiscogsを検索し、候補を返す(上位5件)。
 * 同名・類似名の別人がヒットすることがあるため、呼び出し側で必ず確認を挟むこと
 * (scripts/backfill-artist-discogs-ids.tsでは完全一致1件のみ自動採用)。
 */
export async function searchArtist(name: string): Promise<DiscogsArtistSearchResult[]> {
  const params = new URLSearchParams({ type: 'artist', q: name })
  const data = await fetchDiscogs(`${DISCOGS_BASE}/database/search?${params}`, 'artist search')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).slice(0, 5).map((r: any) => ({
    discogsId: r.id,
    name: r.title,
  }))
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

// Apple Musicに存在しない作品(サブスク未配信の旧譜等)のジャケット画像・発売日・
// レーベル・トラックリストを、リリースページURLから直接取り込むための機能
// (utils/towerRecords.tsのDiscogs版)。既存のfetchDiscogs(認証・レート制限込み)を流用する。

export type DiscogsTrack = {
  discNumber: number
  trackNo: number
  title: string
}

export type DiscogsReleaseInfo = {
  imageUrl?: string
  releaseDate?: string // YYYY-MM-DD
  labelName?: string
  tracks: DiscogsTrack[]
}

function extractReleaseRef(url: string): { kind: 'release' | 'master' | 'listing'; id: number } | null {
  const releaseMatch = url.match(/discogs\.com\/(?:[a-z]{2}\/)?release\/(\d+)/)
  if (releaseMatch) return { kind: 'release', id: parseInt(releaseMatch[1], 10) }
  const masterMatch = url.match(/discogs\.com\/(?:[a-z]{2}\/)?master\/(\d+)/)
  if (masterMatch) return { kind: 'master', id: parseInt(masterMatch[1], 10) }
  // マーケットプレイスの出品ページ(discogs.com/sell/item/... または
  // discogs.com/shop/item/...、どちらも同じ出品IDを指す別表記)。
  // release自体ではなく出品IDなので、まずmarketplace/listingsから紐づくrelease.idを引く。
  const listingMatch = url.match(/discogs\.com\/(?:[a-z]{2}\/)?(?:sell|shop)\/item\/(\d+)/)
  if (listingMatch) return { kind: 'listing', id: parseInt(listingMatch[1], 10) }
  return null
}

// Discogsの`released`は"1987-07-00"のように月日が不明(00)なことがある。
// 不明な月日は01で補い、releasedが無ければ`year`から1月1日として代用する。
function parseReleaseDate(released: string | undefined, year: number | undefined): string | undefined {
  if (released) {
    const m = released.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/)
    if (m) {
      const mo = m[2] && m[2] !== '00' ? m[2] : '01'
      const d = m[3] && m[3] !== '00' ? m[3] : '01'
      return `${m[1]}-${mo}-${d}`
    }
  }
  return year ? `${year}-01-01` : undefined
}

// tracklistの`position`はリリース形態によって表記がバラバラ("1", "1-1"(CD2枚組),
// "A"/"B1"(アナログ盤の面))なため、パターンごとにディスク番号・トラック番号を
// 割り出す。アナログ盤は面A/Bが同一ディスク、C/Dが2枚目...という慣習に合わせ、
// 面の文字を2つずつディスク番号にまとめる。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTrackList(raw: any[]): DiscogsTrack[] {
  const tracks: DiscogsTrack[] = []
  const letterGroups: string[] = []
  const seqByDisc = new Map<number, number>()

  for (const item of raw) {
    if (item.type_ !== 'track') continue
    const title = (item.title ?? '').trim()
    if (!title) continue
    const pos = (item.position ?? '').trim()

    const numDash = pos.match(/^(\d+)-(\d+)$/)
    const letterNum = pos.match(/^([A-Za-z]+)(\d+)?$/)
    const plainNum = pos.match(/^(\d+)$/)

    let discNumber: number
    let trackNo: number

    if (numDash) {
      discNumber = parseInt(numDash[1], 10)
      trackNo = parseInt(numDash[2], 10)
    } else if (letterNum) {
      const letter = letterNum[1].toUpperCase()
      if (!letterGroups.includes(letter)) letterGroups.push(letter)
      discNumber = Math.floor(letterGroups.indexOf(letter) / 2) + 1
      // 面ごとに"A1"〜"A4","B1"〜"B4"のように独自の番号を振っている盤(2枚組LP等)
      // では、その番号をそのまま使うとB面以降でトラック番号が1に巻き戻ってしまう
      // (実際に発生した不具合: 渚にて「本当の世界」で確認)。面の番号表記の有無に
      // 関わらず、ディスク単位で通し番号を振る。
      const next = (seqByDisc.get(discNumber) ?? 0) + 1
      seqByDisc.set(discNumber, next)
      trackNo = next
    } else if (plainNum) {
      discNumber = 1
      trackNo = parseInt(plainNum[1], 10)
    } else {
      continue
    }

    tracks.push({ discNumber, trackNo, title })
  }

  return tracks
}

export async function fetchDiscogsReleaseInfo(url: string): Promise<DiscogsReleaseInfo> {
  const ref = extractReleaseRef(url)
  if (!ref) {
    throw new Error(
      'DiscogsのリリースページのURL(discogs.com/release/... 、/master/... 、/sell(shop)/item/...)を指定してください'
    )
  }

  let releaseId = ref.id
  if (ref.kind === 'master') {
    const master = await fetchDiscogs(`${DISCOGS_BASE}/masters/${ref.id}`, 'master lookup')
    if (!master.main_release) {
      throw new Error('このmasterページには紐づくreleaseがありません')
    }
    releaseId = master.main_release
  } else if (ref.kind === 'listing') {
    const listing = await fetchDiscogs(`${DISCOGS_BASE}/marketplace/listings/${ref.id}`, 'marketplace listing lookup')
    if (!listing.release?.id) {
      throw new Error('この出品ページには紐づくreleaseがありません')
    }
    releaseId = listing.release.id
  }

  const data = await fetchDiscogs(`${DISCOGS_BASE}/releases/${releaseId}`, 'release info')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primaryImage = (data.images ?? []).find((i: any) => i.type === 'primary') ?? data.images?.[0]
  const imageUrl: string | undefined = primaryImage?.uri
  const releaseDate = parseReleaseDate(data.released, data.year)
  const labelName: string | undefined = data.labels?.[0]?.name
  const tracks = buildTrackList(data.tracklist ?? [])

  return { imageUrl, releaseDate, labelName, tracks }
}

// ディスクガイド経由で登録されたアーティスト等、サブスクに存在しない(=iTunesで
// 取り込めない)アーティストは画像・プロフィールが空のまま残ってしまう。
// Discogsのアーティストページから同様の情報を手動取込できるようにする。

export type DiscogsArtistInfo = {
  discogsArtistId: number
  name: string
  imageUrl?: string
  profile?: string
}

function extractArtistId(url: string): number | null {
  const match = url.match(/discogs\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

// Discogsのprofileはウィキ風マークアップ([b]太字[/b]、[url=...]リンク[/url]、
// [a=アーティスト名]相互参照等)を含むため、そのまま保存すると記号が残って
// 読みづらい。表示用に簡易的なプレーンテキストへ変換する。
function stripDiscogsMarkup(text: string): string {
  return text
    .replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/gi, '$1')
    .replace(/\[(?:a|l|m|r|url)=([^\]]*)\]/gi, '$1')
    .replace(/\[\/?(?:b|i|u|url|a|l|m|r)\]/gi, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

export async function fetchDiscogsArtistInfo(url: string): Promise<DiscogsArtistInfo> {
  const artistId = extractArtistId(url)
  if (!artistId) {
    throw new Error('DiscogsのアーティストページのURL(discogs.com/artist/...)を指定してください')
  }

  const data = await fetchDiscogs(`${DISCOGS_BASE}/artists/${artistId}`, 'artist info')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primaryImage = (data.images ?? []).find((i: any) => i.type === 'primary') ?? data.images?.[0]
  const imageUrl: string | undefined = primaryImage?.uri
  const profile: string | undefined = data.profile ? stripDiscogsMarkup(data.profile) : undefined

  return { discogsArtistId: artistId, name: data.name, imageUrl, profile }
}
