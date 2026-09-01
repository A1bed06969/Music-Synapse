const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2'
const USER_AGENT = 'MusicSynapse/1.0 (https://github.com/A1bed06969/Music-Synapse)'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// MusicBrainz's public API intermittently returns 503 "server is currently
// busy" under load, unrelated to the query itself (confirmed live: the same
// query failed once then succeeded seconds later). A 3-attempt retry wasn't
// always enough — a longer overload spell (observed right after a heavy burst
// of our own requests, e.g. a multi-artist bulk import) can outlast a ~3s
// window. Retry a bounded number of times before giving up, still respecting
// the 1 req/sec limit between attempts.
async function fetchMusicBrainz(url: string, label: string): Promise<any> {
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(1000)
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) {
      return res.json()
    }
    if (res.status === 503 && attempt < maxAttempts) {
      continue
    }
    throw new Error(`MusicBrainz API error (${label}): ${res.status}`)
  }
  throw new Error(`MusicBrainz API error (${label}): retries exhausted`)
}

export type ArtistOrigin = { countryCode: string | null; areaName: string | null }

/** アーティストのMBIDから出身国を取得する。MusicBrainzのartistルックアップは
 * inc無しの基本レスポンスでもcountry(ISO 3166-1、例: "US")とarea.name/
 * begin-area.nameを返すため、既存のfetchArtistDetails(url-rels+genres+
 * artist-rels)とは別に、この軽いエンドポイントだけを叩く。 */
export async function fetchArtistOrigin(mbid: string): Promise<ArtistOrigin> {
  const url = `${MUSICBRAINZ_BASE}/artist/${mbid}?fmt=json`
  const data = await fetchMusicBrainz(url, 'artist origin')
  const rawCountryCode: string | undefined = data.country ?? data.area?.['iso-3166-1-codes']?.[0]
  const areaName: string | null = data['begin-area']?.name ?? data.area?.name ?? null
  return { countryCode: rawCountryCode ? rawCountryCode.toLowerCase() : null, areaName }
}

export type MusicBrainzSearchResult = {
  mbid: string
  name: string
  country: string | null
  type: string | null
  beginYear: number | null
  score: number | null
}

export async function searchArtist(name: string): Promise<MusicBrainzSearchResult[]> {
  const url = `${MUSICBRAINZ_BASE}/artist?query=${encodeURIComponent(name)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'artist search')
  return (data.artists ?? []).map((a: any) => ({
    mbid: a.id,
    name: a.name,
    country: a.country ?? null,
    type: a.type ?? null,
    beginYear: a['life-span']?.begin ? Number(String(a['life-span'].begin).slice(0, 4)) : null,
    score: a.score != null && !Number.isNaN(Number(a.score)) ? Number(a.score) : null,
  }))
}

export type MusicBrainzLabelSearchResult = {
  mbid: string
  name: string
  type: string | null
  country: string | null
  areaName: string | null
  foundedYear: number | null
}

export async function searchLabel(name: string): Promise<MusicBrainzLabelSearchResult[]> {
  const url = `${MUSICBRAINZ_BASE}/label?query=${encodeURIComponent(name)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'label search')
  return (data.labels ?? []).map((l: any) => ({
    mbid: l.id,
    name: l.name,
    type: l.type ?? null,
    country: l.country ?? null,
    areaName: l.area?.name ?? null,
    foundedYear: l['life-span']?.begin ? Number(String(l['life-span'].begin).slice(0, 4)) : null,
  }))
}

const ALLOWED_LINK_TYPES = new Set([
  'streaming',
  'free streaming',
  'social network',
  'other databases',
  'allmusic',
  'discogs',
  'wikidata',
  'IMDb',
  'youtube',
  'youtube music',
])

export const LINK_TYPE_LABEL: Record<string, string> = {
  streaming: 'ストリーミング',
  'free streaming': '無料ストリーミング',
  'social network': 'SNS',
  'other databases': 'データベース',
  allmusic: 'AllMusic',
  discogs: 'Discogs',
  wikidata: 'Wikidata',
  IMDb: 'IMDb',
  youtube: 'YouTube',
  'youtube music': 'YouTube Music',
}

// Root domain -> recognizable service name, used so visually-identical
// link_type chips (e.g. multiple "streaming" links) can be told apart at a
// glance. Matched against the hostname's own value or as a suffix (so
// subdomains like `open.qobuz.com` or `s.awa.fm` still match `qobuz.com` /
// `awa.fm`).
const DOMAIN_SERVICE_LABEL: Record<string, string> = {
  'apple.com': 'Apple Music',
  'spotify.com': 'Spotify',
  'amazon.com': 'Amazon Music',
  'amazon.co.jp': 'Amazon Music',
  'tidal.com': 'Tidal',
  'qobuz.com': 'Qobuz',
  'awa.fm': 'AWA',
  'line.me': 'LINE Music',
  'discogs.com': 'Discogs',
  'allmusic.com': 'AllMusic',
  'wikidata.org': 'Wikidata',
  'imdb.com': 'IMDb',
}

/**
 * Prefer a recognizable service name derived from the link URL's hostname
 * (so e.g. multiple `streaming`-typed links can be told apart), falling back
 * to the generic link_type label when the host isn't in our small map.
 */
export function getLinkLabel(url: string, linkType: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')

    if (hostname === 'music.youtube.com') return 'YouTube Music'
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) return 'YouTube'

    for (const [domain, label] of Object.entries(DOMAIN_SERVICE_LABEL)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return label
      }
    }
    return LINK_TYPE_LABEL[linkType] ?? linkType
  } catch {
    return LINK_TYPE_LABEL[linkType] ?? linkType
  }
}

export type MusicBrainzMembership = {
  mbid: string
  name: string
  /** true: このアーティスト(問い合わせ対象)がバンドで、相手が所属メンバー
   *  false: このアーティストが個人で、相手が所属先バンド
   *  (MusicBrainzの"member of band"は個人→バンド方向が正方向で、バンド側から見ると
   *  direction: "backward" として返ってくるため、それを見て判定する) */
  subjectIsBand: boolean
  begin: string | null
  end: string | null
  ended: boolean
  attributes: string[]
}

export type MusicBrainzArtistDetails = {
  officialHomepage: string | null
  twitterUrl: string | null
  instagramUrl: string | null
  links: { type: string; url: string }[]
  genres: string[]
  memberships: MusicBrainzMembership[]
}

export async function fetchArtistDetails(mbid: string): Promise<MusicBrainzArtistDetails> {
  const url = `${MUSICBRAINZ_BASE}/artist/${mbid}?inc=url-rels+genres+artist-rels&fmt=json`
  const data = await fetchMusicBrainz(url, 'artist detail')

  let officialHomepage: string | null = null
  let twitterUrl: string | null = null
  let instagramUrl: string | null = null
  const links: { type: string; url: string }[] = []
  const memberships: MusicBrainzMembership[] = []

  for (const rel of data.relations ?? []) {
    if (rel.type === 'member of band' && rel['target-type'] === 'artist' && rel.artist?.id) {
      memberships.push({
        mbid: rel.artist.id,
        name: rel.artist.name,
        subjectIsBand: rel.direction === 'backward',
        begin: rel.begin ?? null,
        end: rel.end ?? null,
        ended: Boolean(rel.ended),
        attributes: Array.isArray(rel.attributes) ? rel.attributes : [],
      })
      continue
    }

    const relUrl: string | undefined = rel.url?.resource
    if (!rel.type || !relUrl) continue

    if (rel.type === 'official homepage') {
      officialHomepage = relUrl
      continue
    }

    if (rel.type === 'social network') {
      let host = ''
      try {
        host = new URL(relUrl).hostname
      } catch {
        host = ''
      }
      if (host.includes('twitter.com') || host.includes('x.com')) {
        twitterUrl = relUrl
        continue
      }
      if (host.includes('instagram.com')) {
        instagramUrl = relUrl
        continue
      }
    }

    if (ALLOWED_LINK_TYPES.has(rel.type)) {
      links.push({ type: rel.type, url: relUrl })
    }
  }

  const genres = (data.genres ?? [])
    .map((g: any) => g.name)
    .filter((name: unknown): name is string => Boolean(name))

  return { officialHomepage, twitterUrl, instagramUrl, links, genres, memberships }
}

export type MusicBrainzReleaseSearchResult = {
  mbid: string
  title: string
  date: string | null
  country: string | null
  score: number | null
  /** リリースの筆頭アーティストのMBID(artist-creditの先頭)。アーティスト自体の
   * MBID自動照合(utils/artistProfileImport.ts)に使う */
  artistMbid: string | null
}

function escapeLuceneQueryValue(value: string): string {
  return value.replace(/"/g, '\\"')
}

function mapReleaseSearchResults(data: any): MusicBrainzReleaseSearchResult[] {
  return (data.releases ?? []).map((r: any) => {
    const event = Array.isArray(r['release-events']) ? r['release-events'][0] : null
    return {
      mbid: r.id,
      title: r.title,
      date: event?.date ?? null,
      country: event?.area?.name ?? null,
      score: r.score != null && !Number.isNaN(Number(r.score)) ? Number(r.score) : null,
      artistMbid: r['artist-credit']?.[0]?.artist?.id ?? null,
    }
  })
}

export async function searchRelease(title: string, artistName: string): Promise<MusicBrainzReleaseSearchResult[]> {
  const query = `release:"${escapeLuceneQueryValue(title)}" AND artist:"${escapeLuceneQueryValue(artistName)}"`
  const url = `${MUSICBRAINZ_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'release search')
  return mapReleaseSearchResults(data)
}

/**
 * タイトルのみでのrelease検索(アーティスト名で絞らない)。
 * うちのDBのアーティスト名はiTunes JPカタログ由来のカタカナ表記のことが多く、
 * MusicBrainz側には該当するアーティスト名の表記が存在しないため
 * (例:「フー・ファイターズ」⇔"Foo Fighters")、artist:"..."で絞り込むと
 * 海外アーティストで機械的にゼロ件になってしまう。そのためアーティストMBIDの
 * 自動照合(utils/artistProfileImport.ts)ではタイトルのみで検索し、複数タイトルの
 * 一致結果が同じartistMbidに集まるかどうかで確からしさを担保する
 */
export async function searchReleaseByTitle(title: string): Promise<MusicBrainzReleaseSearchResult[]> {
  const query = `release:"${escapeLuceneQueryValue(title)}"`
  const url = `${MUSICBRAINZ_BASE}/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`
  const data = await fetchMusicBrainz(url, 'release search (title only)')
  return mapReleaseSearchResults(data)
}

export type MusicBrainzReleaseCredit = {
  personName: string
  personMbid: string
  role: 'producer' | 'mix' | 'mastering' | 'composer' | 'lyricist' | 'arranger' | 'artwork' | 'musician'
  sourceUrl: string
  /** このクレジットが特定のトラックに紐づく場合の録音タイトル。
   * リリース全体に対するクレジット(アートワーク等)の場合はnull */
  trackTitle: string | null
  /** role==='musician'の場合のみ、演奏楽器名(表示用) */
  instrumentName?: string
}

const RELEASE_ROLE_TYPE_MAP: Record<string, MusicBrainzReleaseCredit['role']> = {
  producer: 'producer',
  mix: 'mix',
  mastering: 'mastering',
  composer: 'composer',
  lyricist: 'lyricist',
  arranger: 'arranger',
  'design/illustration': 'artwork',
}

export type MusicBrainzReleaseCreditsResult = {
  credits: MusicBrainzReleaseCredit[]
  labelName: string | null
  labelMbid: string | null
}

// MusicBrainzの録音(レコーディング)単位の"instrument"タイプ関係(例:
// "drums (drum set)", "bass guitar")は英語の統制語彙で、既存の`instrument`
// テーブルの慣習(例:「ピアノ」)に合わせて和訳する。未収録語は原文のまま返す
// (データを落とすより、英語表記のまま見せる方がまし)。
const INSTRUMENT_NAME_JA: Record<string, string> = {
  'drums (drum set)': 'ドラム',
  drums: 'ドラム',
  'bass guitar': 'ベース',
  bass: 'ベース',
  'electric bass guitar': 'ベース',
  'electric upright bass': 'ウッドベース',
  'french horn': 'ホルン',
  'hammond organ': 'オルガン',
  'electric guitar': 'エレキギター',
  'acoustic guitar': 'アコースティックギター',
  guitar: 'ギター',
  synthesizer: 'シンセサイザー',
  piano: 'ピアノ',
  'electric piano': 'エレクトリックピアノ',
  keyboard: 'キーボード',
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
  horn: 'ホルン',
  'double bass': 'ウッドベース',
  'drum machine': 'ドラムマシン',
}

function translateInstrumentName(rawName: string): string {
  return INSTRUMENT_NAME_JA[rawName.toLowerCase().trim()] ?? rawName
}

// Producer/mix/mastering/composer/lyricist/arranger credits, and instrument
// performance data, are attached to each recording (track) in MusicBrainz,
// not to the release itself — release-level relations only cover
// whole-release credits (e.g. cover artwork). Fetching just the release
// therefore misses nearly all real data; both sources are needed.
//
// 作詞・作曲は実際にはrecording(録音)ではなくWork(楽曲そのもの)エンティティに
// 付くのが基本(実データで確認済み: 同じ曲の別バージョン/別リリースでも
// Work側のクレジットは共通)。そのためrecordingのwork-relsからWorkのMBIDを辿り、
// Workごとに追加でartist-relsを取得する(Work単位でまとめて1回のfetch、
// レート制限は既存のfetchMusicBrainzが1req/secで担保)。
export async function fetchReleaseCreditsAndInstruments(
  releaseMbid: string
): Promise<MusicBrainzReleaseCreditsResult> {
  const sourceUrl = `https://musicbrainz.org/release/${releaseMbid}`

  const releaseData = await fetchMusicBrainz(
    `${MUSICBRAINZ_BASE}/release/${releaseMbid}?inc=artist-rels+labels&fmt=json`,
    'release credits'
  )
  const recordingData = await fetchMusicBrainz(
    `${MUSICBRAINZ_BASE}/recording?release=${releaseMbid}&inc=artist-rels+work-rels&fmt=json&limit=100`,
    'recording credits'
  )

  const seenCredits = new Set<string>()
  const credits: MusicBrainzReleaseCredit[] = []

  function addCredit(
    personMbid: string,
    personName: string,
    role: MusicBrainzReleaseCredit['role'],
    trackTitle: string | null,
    instrumentName?: string
  ) {
    const key = `${personMbid}:${role}:${trackTitle ?? ''}:${instrumentName ?? ''}`
    if (seenCredits.has(key)) return
    seenCredits.add(key)
    credits.push({ personName, personMbid, role, sourceUrl, trackTitle, instrumentName })
  }

  function addArtistRelations(relations: any[] | undefined, trackTitle: string | null) {
    for (const rel of relations ?? []) {
      const role = RELEASE_ROLE_TYPE_MAP[rel.type]
      if (!role) continue
      if (!rel.artist?.id || !rel.artist?.name) continue
      addCredit(rel.artist.id, rel.artist.name, role, trackTitle)
    }
  }

  // ① リリース全体のクレジット(アートワーク等) — 特定トラックに紐づかない
  addArtistRelations(releaseData.relations, null)

  // ② 録音ごとのクレジット・演奏楽器(演奏者名つき)・関連Workを収集
  const trackTitlesByWorkMbid = new Map<string, string[]>()

  for (const recording of recordingData.recordings ?? []) {
    addArtistRelations(recording.relations, recording.title)

    for (const rel of recording.relations ?? []) {
      if (rel.type === 'instrument' && rel.artist?.id && rel.artist?.name) {
        for (const attr of rel.attributes ?? []) {
          addCredit(rel.artist.id, rel.artist.name, 'musician', recording.title, translateInstrumentName(attr))
        }
      }
      if (rel.type === 'performance' && rel.work?.id) {
        const list = trackTitlesByWorkMbid.get(rel.work.id) ?? []
        list.push(recording.title)
        trackTitlesByWorkMbid.set(rel.work.id, list)
      }
    }
  }

  // ③ Workごとに作詞・作曲・編曲クレジットを取得し、紐づく各トラックへ反映
  for (const [workMbid, trackTitles] of trackTitlesByWorkMbid) {
    let workData: any
    try {
      workData = await fetchMusicBrainz(`${MUSICBRAINZ_BASE}/work/${workMbid}?inc=artist-rels&fmt=json`, 'work credits')
    } catch (err) {
      console.error(`Work情報の取得に失敗しました(${workMbid}):`, err)
      continue // この曲のWork情報が取れなくても他の曲の処理は続ける
    }
    for (const trackTitle of trackTitles) {
      addArtistRelations(workData.relations, trackTitle)
    }
  }

  // label-infoは複数レーベル(共同流通盤等)を返しうるが、代表として先頭の1件のみ扱う
  // (コンピレーション盤のような複数レーベル絡みのケースは今回のスコープ外)
  const labelInfo = releaseData['label-info']?.[0]?.label
  return { credits, labelName: labelInfo?.name ?? null, labelMbid: labelInfo?.id ?? null }
}

/** レーベルのMBIDから発足年だけを取得する軽量ルックアップ。新規レーベル作成時、
 * または既存レーベルのfounded_yearが未設定な場合にだけ呼ぶ想定。 */
export async function fetchLabelFoundedYear(labelMbid: string): Promise<number | null> {
  const data = await fetchMusicBrainz(`${MUSICBRAINZ_BASE}/label/${labelMbid}?fmt=json`, 'label lookup')
  const begin = data['life-span']?.begin
  return begin ? Number(String(begin).slice(0, 4)) : null
}
