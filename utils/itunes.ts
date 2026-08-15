// utils/itunes.ts
// iTunes Search/Lookup APIとのやり取りをまとめたユーティリティ
// 参考: https://performance-partners.apple.com/search-api

const ITUNES_LOOKUP_BASE = 'https://itunes.apple.com/lookup'

export type ItunesArtist = {
  wrapperType: 'artist'
  artistId: number
  artistName: string
  artistLinkUrl?: string
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
 * アーティスト情報 + アルバム一覧を1回のlookupで取得
 */
export async function fetchArtistWithAlbums(artistId: string): Promise<{
  artist: ItunesArtist | null
  albums: ItunesAlbum[]
}> {
  const url = `${ITUNES_LOOKUP_BASE}?id=${artistId}&entity=album&limit=200&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (artist lookup): ${res.status}`)
  }
  const data = await res.json()

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
export async function fetchTracksForAlbum(albumId: number): Promise<{
  tracks: ItunesTrack[]
  localizedCollectionName: string | null
}> {
  await sleep(400) // 連続呼び出しでの403対策(GAS時代と同じ考え方)
  const url = `${ITUNES_LOOKUP_BASE}?id=${albumId}&entity=song&limit=200&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (album lookup): ${res.status}`)
  }
  const data = await res.json()
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
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (album lookup): ${res.status}`)
  }
  const data = await res.json()
  return data.results.find((r: any) => r.wrapperType === 'collection') ?? null
}

/**
 * キーワードでアルバムを検索する(entity=album)。管理画面の検索・選択式
 * バルク登録UIで使う。iTunes Search APIの上限は200件だが、検索候補表示用に
 * limitを絞って明示的に指定する
 */
export async function searchAlbums(term: string, limit = 10): Promise<ItunesAlbum[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=${limit}&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (album search): ${res.status}`)
  }
  const data = await res.json()
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
 * キーワードでトラックを検索する(entity=song)。管理画面の検索・選択式
 * バルク登録UIで使う
 */
export async function searchTracks(term: string, limit = 10): Promise<ItunesTrackSearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (track search): ${res.status}`)
  }
  const data = await res.json()
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
export async function searchArtist(name: string): Promise<ItunesArtistSearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (artist search): ${res.status}`)
  }
  const data = await res.json()
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
 * アルバム一覧のartistNameから、本人名義と異なる連名クレジットを人名単位に分解して返す。
 * 括弧の深さを追跡し、深さ0の「,」「&」でのみ分割する(例:
 * "ACAね(ずっと真夜中でいいのに。), Rin音, Yaffle" は
 * ["ACAね(ずっと真夜中でいいのに。)", "Rin音", "Yaffle"] に分解され、本人名義"Yaffle"は除外される)。
 */
export function extractCollaboratorNames(primaryArtistName: string, albums: ItunesAlbum[]): string[] {
  const names = new Set<string>()

  for (const album of albums) {
    if (!album.artistName || album.artistName === primaryArtistName) continue

    let depth = 0
    let current = ''
    const parts: string[] = []
    for (const ch of album.artistName) {
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

    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed && trimmed !== primaryArtistName) {
        names.add(trimmed)
      }
    }
  }

  return Array.from(names)
}