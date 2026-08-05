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

  return { artist, albums }
}

/**
 * 指定アルバムの収録トラック一覧を取得
 */
export async function fetchTracksForAlbum(albumId: number): Promise<ItunesTrack[]> {
  await sleep(400) // 連続呼び出しでの403対策(GAS時代と同じ考え方)
  const url = `${ITUNES_LOOKUP_BASE}?id=${albumId}&entity=song&limit=200&country=JP`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`iTunes API error (album lookup): ${res.status}`)
  }
  const data = await res.json()
  return data.results.filter((r: any) => r.wrapperType === 'track')
}

/**
 * ミリ秒を「分:秒」に変換(表示用。DBには秒数で保持する)
 */
export function millisToSeconds(millis?: number): number | null {
  if (!millis) return null
  return Math.round(millis / 1000)
}