// utils/itunes.ts
// iTunes Search/Lookup APIとのやり取りをまとめたユーティリティ
// 参考: https://performance-partners.apple.com/search-api

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const ITUNES_LOOKUP_BASE = 'https://itunes.apple.com/lookup'

export type ItunesArtist = {
  wrapperType: 'artist'
  artistId: number
  artistName: string
  artistLinkUrl?: string
  /** 同名で既に本登録済みの別アーティストが見つかった際、Geminiによる同一人物
   * 判定の材料として使う(呼び出し元がsearchArtist等のジャンル情報を持つ検索
   * 結果から渡せる場合のみ設定。省略時は判定材料が名前のみになり、常に
   * 確信度が低く扱われる=安全側)。 */
  primaryGenreName?: string
}

export type ItunesAlbum = {
  wrapperType: 'collection'
  collectionId: number
  collectionName: string
  artistId: number
  artistName: string
  releaseDate: string // ISO文字列
  trackCount: number
  artworkUrl100?: string
  collectionType?: string // 'Album' 等
}

export type ItunesTrack = {
  wrapperType: 'track'
  trackId: number
  trackName: string
  collectionId: number
  artistId: number
  trackNumber: number
  discNumber: number
  trackTimeMillis?: number
  previewUrl?: string
}

// 簡易レートリミット対策(GAS時代の403対策と同じ考え方: 呼び出し間隔を空ける)
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// iTunes Search/Lookup APIは非公式かつ無認証で、明文化されたレート制限が無いが、
// Apple公式の目安は「約20件/分」(https://performance-partners.apple.com/search-api、
// 2026年8月時点でも変更なしと確認済み)。以前はMIN_REQUEST_INTERVAL_MS=400
// (理論上150件/分)で運用しており、この枠を7.5倍超過していた上に、間隔管理が
// プロセス内メモリだけだったため複数スクリプトを同時実行すると合算でさらに
// 超過し、2026-09-24〜25に20時間以上ブロックされる事態が発生した
// (403/429時も次のアイテムへ即座に進み叩き続けていたため悪化した可能性が高い)。
// これを受けて以下の2点を追加:
// ①間隔を3.5秒(約17件/分、20件/分の枠に余裕を持たせる)に引き上げ
// ②間隔・連続失敗回数をプロセス間で共有するファイル(.itunes-rate-limit.json、
//   gitignore対象)に持たせ、同時に複数スクリプトが動いても合算で枠を守る
// ③サーキットブレーカー: 連続403/429がCIRCUIT_BREAKER_THRESHOLD回に達したら
//   CIRCUIT_BREAKER_COOLDOWN_MSの間はネットワークに一切アクセスせず即座に
//   失敗させる(ブロック中に叩き続けて悪化させるのを防ぐ)。クールダウンが
//   明ければ自動的に通常動作へ戻る。
const MIN_REQUEST_INTERVAL_MS = 3500
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000

const RATE_LIMIT_STATE_PATH = join(process.cwd(), '.itunes-rate-limit.json')

type ItunesRateLimitState = {
  lastRequestAt: number
  consecutiveFailures: number
  cooldownUntil: number
}

function readRateLimitState(): ItunesRateLimitState {
  try {
    return JSON.parse(readFileSync(RATE_LIMIT_STATE_PATH, 'utf-8'))
  } catch {
    return { lastRequestAt: 0, consecutiveFailures: 0, cooldownUntil: 0 }
  }
}

function writeRateLimitState(state: ItunesRateLimitState) {
  try {
    writeFileSync(RATE_LIMIT_STATE_PATH, JSON.stringify(state))
  } catch (err) {
    console.error('iTunesレート制限状態の保存に失敗しました:', (err as Error).message)
  }
}

async function fetchItunes(url: string, label: string): Promise<any> {
  const maxAttempts = 4
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const state = readRateLimitState()

    if (state.cooldownUntil > Date.now()) {
      const remainingSec = Math.ceil((state.cooldownUntil - Date.now()) / 1000)
      throw new Error(`iTunes API error (${label}): クールダウン中(あと約${remainingSec}秒はリクエストを送らない)`)
    }

    const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - state.lastRequestAt)
    if (waitMs > 0) await sleep(waitMs)
    writeRateLimitState({ ...state, lastRequestAt: Date.now() })

    const res = await fetch(url)
    if (res.ok) {
      writeRateLimitState({ ...readRateLimitState(), consecutiveFailures: 0 })
      return res.json()
    }

    if (res.status === 403 || res.status === 429) {
      const current = readRateLimitState()
      const consecutiveFailures = current.consecutiveFailures + 1
      if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        writeRateLimitState({
          lastRequestAt: Date.now(),
          consecutiveFailures: 0,
          cooldownUntil: Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS,
        })
        throw new Error(`iTunes API error (${label}): ${res.status}(連続失敗のためクールダウンに入りました)`)
      }
      writeRateLimitState({ ...current, lastRequestAt: Date.now(), consecutiveFailures })
      if (attempt < maxAttempts) {
        await sleep(2000 * attempt)
        continue
      }
    }
    throw new Error(`iTunes API error (${label}): ${res.status}`)
  }
  throw new Error(`iTunes API error (${label}): retries exhausted`)
}

/**
 * Apple Music(iTunes)のアーティストURLからアーティストIDを抽出する
 * 例: https://music.apple.com/jp/artist/tatsuro-yamashita/78500557 -> 78500557
 */
export function extractArtistIdFromUrl(url: string): string | null {
  const match = url.match(/\/artist\/[^/]+\/(\d+)/)
  if (match) return match[1]

  // 数字のみが渡された場合(すでにIDそのもの)にも対応
  if (/^\d+$/.test(url.trim())) return url.trim()

  return null
}

/**
 * Apple Musicのアルバム/シングルURLからcollectionId(と、曲を選択した状態で
 * コピーされたURLならtrackIdも)を抽出する。
 * 例: https://music.apple.com/jp/album/breakthrough-single/1894582290 -> {collectionId: 1894582290, trackId: null}
 * 例: https://music.apple.com/jp/album/xxx/1894582290?i=6762537700 -> {collectionId: 1894582290, trackId: 6762537700}
 * 検索でうまく見つからない(表記ゆれ・無名アーティストが同名の有名曲に検索順位で
 * 負ける等)場合の手動フォールバック用。
 */
export function parseAppleMusicAlbumUrl(url: string): { collectionId: number; trackId: number | null } | null {
  const collectionMatch = url.match(/\/album\/[^/]+\/(\d+)/)
  if (!collectionMatch) return null
  const trackMatch = url.match(/[?&]i=(\d+)/)
  return {
    collectionId: Number(collectionMatch[1]),
    trackId: trackMatch ? Number(trackMatch[1]) : null,
  }
}

/**
 * Apple MusicのアーティストページURLからartistIdとストアフロント国コードを抽出する。
 * 例: https://music.apple.com/us/artist/ciel/1234567890 -> {artistId: 1234567890, country: 'US'}
 * 名前検索が同名・類似名の別人に埋もれて見つからない場合の手動フォールバック用。
 * 国コードが取れない場合はJP扱いにする。
 */
export function parseAppleMusicArtistUrl(url: string): { artistId: number; country: string } | null {
  const match = url.match(/\/artist\/[^/]+\/(\d+)/)
  if (!match) return null
  const countryMatch = url.match(/music\.apple\.com\/([a-z]{2})\//i)
  return { artistId: Number(match[1]), country: countryMatch ? countryMatch[1].toUpperCase() : 'JP' }
}

/**
 * アーティスト情報 + アルバム一覧を1回のlookupで取得。
 * countryは基本JPだが、日本のカタログには存在せず海外ストアフロントでのみ
 * サブスク解禁されているアーティスト(例: マキシマム ザ ホルモンの一部作品)向けに
 * 呼び出し側から指定できるようにしている。
 */
export async function fetchArtistWithAlbums(artistId: string, country = 'JP'): Promise<{
  artist: ItunesArtist | null
  albums: ItunesAlbum[]
}> {
  const url = `${ITUNES_LOOKUP_BASE}?id=${artistId}&entity=album&limit=200&country=${country}`
  const data = await fetchItunes(url, 'artist lookup')

  const artist = data.results.find((r: any) => r.wrapperType === 'artist') ?? null
  const albums = data.results.filter((r: any) => r.wrapperType === 'collection')

  // トップレベルのartistオブジェクトのartistNameはcountry=JPを指定していてもローマ字化
  // されていることがある(例:「名誉伝説」が"MEIYO DENSETSU"になる)。同じレスポンス内の
  // アルバム(collection)側のartistNameは一貫して正しく日本語化されているが、コラボ・
  // features作品では複数アーティストの連名になっていることがあるため、先頭のアルバムを
  // 単純採用すると誤ったアーティスト名になりうる(例: 直近リリースがフィーチャリング作品だと
  // 「ACAね(...), Rin音, Yaffle」のような連名がそのまま採用されてしまう)。
  // そのため全アルバムの中で最も出現頻度が高いartistNameを採用する
  // (通常は本人名義のソロリリースが大多数を占めるため)。
  if (artist && albums.length > 0) {
    const nameCounts = new Map<string, number>()
    for (const album of albums) {
      if (!album.artistName) continue
      nameCounts.set(album.artistName, (nameCounts.get(album.artistName) ?? 0) + 1)
    }
    let mostCommonName: string | null = null
    let mostCommonCount = 0
    for (const [name, count] of nameCounts) {
      if (count > mostCommonCount) {
        mostCommonName = name
        mostCommonCount = count
      }
    }
    if (mostCommonName) {
      artist.artistName = mostCommonName
    }
  }

  return { artist, albums }
}

/**
 * 指定アルバムの収録トラック一覧を取得
 * あわせて、そのアルバムの正しく日本語化されたタイトルも返す
 * (entity=albumのcollectionNameはローマ字化されていることがあるが、
 *  entity=song側の各トラックが持つcollectionNameは一貫して正しく日本語化されているため)
 */
export async function fetchTracksForAlbum(albumId: number, country = 'JP'): Promise<{
  tracks: ItunesTrack[]
  localizedCollectionName: string | null
}> {
  const url = `${ITUNES_LOOKUP_BASE}?id=${albumId}&entity=song&limit=200&country=${country}`
  const data = await fetchItunes(url, 'album lookup (tracks)')
  const tracks = data.results.filter((r: any) => r.wrapperType === 'track')
  const localizedCollectionName = tracks.length > 0 ? (tracks[0].collectionName ?? null) : null
  return { tracks, localizedCollectionName }
}

/**
 * ミリ秒を「分:秒」に変換(表示用。DBには秒数で保持する)
 */
export function millisToSeconds(millis?: number): number | null {
  if (!millis) return null
  return Math.round(millis / 1000)
}

export type ItunesArtistSearchResult = {
  artistId: number
  artistName: string
  primaryGenreName?: string
  artistLinkUrl?: string
}

/**
 * 指定IDのアルバム単体を取得する(検索結果からの単一アルバム/トラック登録で、
 * フィールドが揃った正規のアルバムオブジェクトを得るために使う)
 */
export async function fetchAlbumById(collectionId: number): Promise<ItunesAlbum | null> {
  const url = `${ITUNES_LOOKUP_BASE}?id=${collectionId}&entity=album&country=JP`
  const data = await fetchItunes(url, 'album lookup')
  return data.results.find((r: any) => r.wrapperType === 'collection') ?? null
}

/**
 * キーワードでアルバムを検索する(entity=album)。管理画面の検索・選択式
 * バルク登録UIで使う。iTunes Search APIの上限は200件だが、検索候補表示用に
 * limitを絞って明示的に指定する
 */
export async function searchAlbums(term: string, limit = 10, country = 'JP'): Promise<ItunesAlbum[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=${limit}&country=${country}`
  const data = await fetchItunes(url, 'album search')
  return (data.results ?? []).filter((r: any) => r.wrapperType === 'collection')
}

export type ItunesTrackSearchResult = {
  trackId: number
  trackName: string
  artistId: number
  artistName: string
  collectionId: number
  collectionName: string
  artworkUrl100?: string
}

/**
 * 指定IDのトラック単体を取得する(検索結果から選択したtrackIdの完全な情報を
 * 再取得するために使う。searchTracksはキーワード検索でありID直接引きができないため、
 * 選択後の確定保存にはこちらのLookup APIベースの関数を使うこと)
 */
export async function fetchTrackById(trackId: number): Promise<ItunesTrackSearchResult | null> {
  const url = `${ITUNES_LOOKUP_BASE}?id=${trackId}&entity=song&country=JP`
  const data = await fetchItunes(url, 'track lookup')
  const r = data.results.find((x: any) => x.wrapperType === 'track')
  if (!r) return null
  return {
    trackId: r.trackId,
    trackName: r.trackName,
    artistId: r.artistId,
    artistName: r.artistName,
    collectionId: r.collectionId,
    collectionName: r.collectionName,
    artworkUrl100: r.artworkUrl100,
  }
}

/**
 * キーワードでトラックを検索する(entity=song)。管理画面の検索・選択式
 * バルク登録UIで使う
 */
export async function searchTracks(term: string, limit = 10): Promise<ItunesTrackSearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}&country=JP`
  const data = await fetchItunes(url, 'track search')
  return (data.results ?? [])
    .filter((r: any) => r.wrapperType === 'track')
    .map((r: any) => ({
      trackId: r.trackId,
      trackName: r.trackName,
      artistId: r.artistId,
      artistName: r.artistName,
      collectionId: r.collectionId,
      collectionName: r.collectionName,
      artworkUrl100: r.artworkUrl100,
    }))
}

/**
 * アーティスト名でApple Musicを検索し、候補を返す(上位5件)。
 * 同名・類似名の別人がヒットすることがあるため、呼び出し側で必ず人間の確認を挟むこと。
 */
export async function searchArtist(name: string, country = 'JP'): Promise<ItunesArtistSearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5&country=${country}`
  const data = await fetchItunes(url, 'artist search')
  return (data.results ?? [])
    .filter((r: any) => r.wrapperType === 'artist')
    .map((r: any) => ({
      artistId: r.artistId,
      artistName: r.artistName,
      primaryGenreName: r.primaryGenreName,
      artistLinkUrl: r.artistLinkUrl,
    }))
}

/**
 * feat.抽出で判明したアーティスト名から、Apple Music上のartistIdを解決する。
 * 完全一致が1件だけならそれを採用するが、"Boyish"のように完全一致が複数ある
 * 同名アーティストの場合は、それだけでは正しい方を選べない。そこで各候補の
 * カタログ(fetchArtistWithAlbums)を実際に取得し、元曲のアルバム/シングルの
 * collectionIdがその候補の作品一覧に含まれているかで絞り込む(Apple Musicは
 * フィーチャリング曲を「参加作品」として当人のカタログにも同じcollectionIdで
 * 掲載する挙動があり、utils/itunes.tsの他の同期処理でも同じ前提を使っている)。
 *
 * confirmedIdは本人確認済み(apple_music_artist_idに保存してよい確度)。
 * bestGuessIdは裏取りしきれず確定できなかった場合でも、画像取得など
 * 「間違っていても実害の小さい用途」向けに検索結果の先頭候補を返す
 * (2026-09-24、ユーザー要望「featアーティストも画像だけは拾いたい」)。
 * 候補が0件の場合は両方nullになる。 */
export async function resolveFeaturedArtistCandidate(
  name: string,
  sourceAlbumId: string | null,
  country = 'JP'
): Promise<{ confirmedId: string | null; bestGuessId: string | null }> {
  const candidates = await searchArtist(name, country)
  const normalize = (s: string) => s.trim().toLowerCase()
  const exactMatches = candidates.filter((c) => normalize(c.artistName) === normalize(name))

  if (exactMatches.length === 0) return { confirmedId: null, bestGuessId: null }
  if (exactMatches.length === 1) {
    const id = String(exactMatches[0].artistId)
    return { confirmedId: id, bestGuessId: id }
  }
  if (!sourceAlbumId) return { confirmedId: null, bestGuessId: String(exactMatches[0].artistId) }

  const catalogMatches: string[] = []
  for (const candidate of exactMatches) {
    const candidateId = String(candidate.artistId)
    try {
      const { albums } = await fetchArtistWithAlbums(candidateId, country)
      if (albums.some((a) => String(a.collectionId) === sourceAlbumId)) {
        catalogMatches.push(candidateId)
      }
    } catch (err) {
      console.error(`カタログ照合に失敗しました(候補artistId=${candidateId}):`, (err as Error).message)
    }
  }
  return {
    confirmedId: catalogMatches.length === 1 ? catalogMatches[0] : null,
    bestGuessId: catalogMatches[0] ?? String(exactMatches[0].artistId),
  }
}

/** resolveFeaturedArtistCandidateの本人確認済み結果だけを返す薄いラッパー。
 * apple_music_artist_idの確定用途(既存呼び出し元)向け。 */
export async function resolveFeaturedArtistAppleMusicId(
  name: string,
  sourceAlbumId: string | null,
  country = 'JP'
): Promise<string | null> {
  const { confirmedId } = await resolveFeaturedArtistCandidate(name, sourceAlbumId, country)
  return confirmedId
}

/**
 * アルバム一覧のartistNameから、本人名義と異なる連名クレジットを人名単位に分解して返す。
 * 括弧の深さを追跡し、深さ0の「,」「&」でのみ分割する(例:
 * "ACAね(ずっと真夜中でいいのに。), Rin音, Yaffle" は
 * ["ACAね(ずっと真夜中でいいのに。)", "Rin音", "Yaffle"] に分解され、本人名義"Yaffle"は除外される)。
 */
/** "ACAね(ずっと真夜中でいいのに。), Rin音, Yaffle"のような連名クレジット文字列を、
 * 括弧の深さを追跡しながら深さ0の「,」「&」でのみ分割して人名単位の配列にする。 */
export function splitCollabArtistName(rawName: string): string[] {
  let depth = 0
  let current = ''
  const parts: string[] = []
  for (const ch of rawName) {
    if (ch === '(' || ch === '（') depth++
    if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1)
    if (depth === 0 && (ch === ',' || ch === '&')) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

export function extractCollaboratorNames(primaryArtistName: string, albums: ItunesAlbum[]): string[] {
  const names = new Set<string>()

  for (const album of albums) {
    if (!album.artistName || album.artistName === primaryArtistName) continue
    for (const part of splitCollabArtistName(album.artistName)) {
      if (part !== primaryArtistName) names.add(part)
    }
  }

  return Array.from(names)
}

/**
 * ある1枚のアルバム/シングルについて、そのartistName連名クレジットの中から
 * 「今同期しようとしているアーティスト(syncingArtistName、例: feat.抽出された
 * 「Grandma」)」以外の名義が1つだけ残る場合、それを本来の主アーティスト名として返す。
 * feat.アーティスト自身のカタログ同期(dispatchAlbumSync)で、そのアーティストが
 * 実はフィーチャリング側でしかない作品(主アーティストが別に存在する)を
 * そのまま同期すると、主アーティストが一切登録されないままfeat.アーティストの
 * 名義で作品が計上されてしまう(2026-09-22、ユーザー報告「Grandma」の誕生日ソング
 * 単体シングルの例)。連名が2名以上に分かれる、または該当アーティスト名が
 * 連名に含まれない場合はnullを返し、判定を諦める(安全側)。 */
export function resolveTruePrimaryArtistName(syncingArtistName: string, albumArtistName: string): string | null {
  if (!albumArtistName || albumArtistName === syncingArtistName) return null
  const parts = splitCollabArtistName(albumArtistName)
  if (!parts.includes(syncingArtistName)) return null
  const others = parts.filter((p) => p !== syncingArtistName)
  return others.length === 1 ? others[0] : null
}