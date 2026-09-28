// utils/spotify.ts
//
// Apple Musicのカタログに無いがSpotifyには存在するアルバム(インディー/海外の
// レア盤等)を、SpotifyのアルバムURLから直接取り込むためのクライアント。
// Client Credentials方式(サーバー間認証のみ、ユーザー認可不要)で完結する
// 範囲に限定する。認証仕様はdocs/superpowers/specs/2026-08-07-
// spotify-artist-images-design.mdで事前調査済みのものを踏襲。

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Spotify Web APIのレート制限は「直近30秒のローリングウィンドウ」単位、かつ
// itunes.apple.com/searchと違いIPではなく**アプリ(クライアントID)単位**で
// カウントされる(https://developer.apple.com/ ではなくdeveloper.spotify.com/
// documentation/web-api/concepts/rate-limits、2026-09-26調査)。実測ベースでは
// 180req/分程度までは429にならないとの報告があるが、非公式な目安に過ぎないため
// 半分以下の余裕を持たせる(直近30秒で最大40件=80件/分ペース)。429時は
// Retry-Afterヘッダー(秒数)に必ず従う設計になっているため、それを厳守した上で、
// 連続でRetry-Afterに従っても429が続く場合はサーキットブレーカーで長めに休む
// (utils/itunes.tsの2026-09-25の対応と同じ考え方)。
const MAX_REQUESTS_PER_WINDOW = 40
const WINDOW_MS = 30_000
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000

const RATE_LIMIT_STATE_PATH = join(process.cwd(), '.spotify-rate-limit.json')

type SpotifyRateLimitState = {
  // 直近WINDOW_MS以内に送信したリクエストのタイムスタンプ(ミリ秒epoch)
  recentRequestTimestamps: number[]
  consecutiveFailures: number
  cooldownUntil: number
}

function readRateLimitState(): SpotifyRateLimitState {
  try {
    const parsed = JSON.parse(readFileSync(RATE_LIMIT_STATE_PATH, 'utf-8'))
    return {
      recentRequestTimestamps: Array.isArray(parsed.recentRequestTimestamps) ? parsed.recentRequestTimestamps : [],
      consecutiveFailures: parsed.consecutiveFailures ?? 0,
      cooldownUntil: parsed.cooldownUntil ?? 0,
    }
  } catch {
    return { recentRequestTimestamps: [], consecutiveFailures: 0, cooldownUntil: 0 }
  }
}

function writeRateLimitState(state: SpotifyRateLimitState) {
  try {
    writeFileSync(RATE_LIMIT_STATE_PATH, JSON.stringify(state))
  } catch (err) {
    console.error('Spotifyレート制限状態の保存に失敗しました:', (err as Error).message)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Spotify Web APIへの全リクエストが通る共通fetch。ウィンドウ内の件数管理・
 * Retry-Afterの厳守・サーキットブレーカーをプロセス間で共有するファイル
 * (.spotify-rate-limit.json、gitignore対象)で一本化する。
 */
async function fetchSpotify(url: string, init: RequestInit): Promise<Response> {
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const state = readRateLimitState()

    if (state.cooldownUntil > Date.now()) {
      const remainingSec = Math.ceil((state.cooldownUntil - Date.now()) / 1000)
      throw new Error(`Spotify APIエラー: クールダウン中(あと約${remainingSec}秒はリクエストを送らない)`)
    }

    const now = Date.now()
    const recent = state.recentRequestTimestamps.filter((t) => now - t < WINDOW_MS)
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      const oldest = recent[0]
      const waitMs = WINDOW_MS - (now - oldest) + 100
      await sleep(waitMs)
    }

    const sentAt = Date.now()
    writeRateLimitState({ ...state, recentRequestTimestamps: [...recent, sentAt] })

    const res = await fetch(url, init)
    if (res.ok) {
      const current = readRateLimitState()
      writeRateLimitState({ ...current, consecutiveFailures: 0 })
      return res
    }

    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get('Retry-After') ?? '5')
      const current = readRateLimitState()
      const consecutiveFailures = current.consecutiveFailures + 1
      if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        writeRateLimitState({
          recentRequestTimestamps: current.recentRequestTimestamps,
          consecutiveFailures: 0,
          cooldownUntil: Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS,
        })
        throw new Error('Spotify APIエラー: 429(Retry-After尊守後も連続失敗のためクールダウンに入りました)')
      }
      writeRateLimitState({ ...current, consecutiveFailures })
      if (attempt < maxAttempts) {
        await sleep((retryAfterSec + 1) * 1000)
        continue
      }
    }
    return res
  }
  throw new Error('Spotify APIエラー: retries exhausted')
}

let cachedToken: { token: string; expiresAt: number } | null = null

async function getSpotifyAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRETが設定されていません。')
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    throw new Error(`Spotify認証に失敗しました (${res.status})`)
  }
  const data = await res.json()
  // 有効期限ぎりぎりでの失効を避けるため60秒早めに切れたことにする
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return cachedToken.token
}

export type SpotifyArtistSearchResult = {
  id: string
  name: string
  imageUrl: string | null
}

/**
 * アーティスト名でSpotifyを検索し、候補を返す(上位5件)。画像URLはAPIレスポンスに
 * 直接含まれるため(og:imageスクレイピング不要)、iTunesより確度高く取得できる。
 * feat.アーティストの画像取得フォールバック用(2026-09-24、iTunesの検索APIが
 * レート制限(403)にかかりやすい問題を受けて追加)。
 */
export async function searchSpotifyArtist(name: string): Promise<SpotifyArtistSearchResult[]> {
  const token = await getSpotifyAccessToken()
  const url = `https://api.spotify.com/v1/search?type=artist&market=JP&limit=5&q=${encodeURIComponent(name)}`
  const res = await fetchSpotify(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`Spotify APIエラー (artist search): ${res.status}`)
  }
  const data = await res.json()
  type RawArtist = { id: string; name: string; images?: { url: string }[] }
  const items: RawArtist[] = data.artists?.items ?? []
  return items.map((a) => ({
    id: a.id,
    name: a.name,
    imageUrl: a.images?.[0]?.url ?? null,
  }))
}

/**
 * feat.抽出で判明したアーティスト名から、Apple Musicで解決できなかった場合の
 * フォールバックとして画像だけをベストエフォートで取得する。名前の完全一致が
 * 1件ならそれを、複数/0件の場合でも検索結果の先頭候補を採用する(本人特定用途
 * ではなく画像取得のみが目的のため、多少の誤爆は許容する)。
 */
export async function resolveFeaturedArtistImageFromSpotify(name: string): Promise<string | null> {
  const candidates = await searchSpotifyArtist(name)
  if (candidates.length === 0) return null

  const normalize = (s: string) => s.trim().toLowerCase()
  const exactMatch = candidates.find((c) => normalize(c.name) === normalize(name))
  return (exactMatch ?? candidates[0]).imageUrl
}

/** SpotifyのアルバムページURL(https://open.spotify.com/album/{id}、
 * 地域プレフィックス付きのintl-ja/album/{id}等も含む)からアルバムIDを取り出す。 */
export function parseSpotifyAlbumUrl(url: string): string | null {
  const match = url.match(/open\.spotify\.com\/(?:[a-z-]+\/)?album\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

export type SpotifyTrack = {
  id: string
  name: string
  trackNumber: number
  discNumber: number
  durationMs: number
  previewUrl: string | null
}

export type SpotifyAlbum = {
  id: string
  name: string
  artistName: string
  releaseDate: string | null
  imageUrl: string | null
  tracks: SpotifyTrack[]
}

/** release_date_precisionが"year"/"month"の場合、DATE型カラムに入れられるよう
 * 月日を1で補完する(Spotifyは発売日が年までしか分かっていない作品も多い)。 */
function normalizeReleaseDate(releaseDate: string | undefined, precision: string | undefined): string | null {
  if (!releaseDate) return null
  if (precision === 'day') return releaseDate
  if (precision === 'month') return `${releaseDate}-01`
  if (precision === 'year') return `${releaseDate}-01-01`
  return releaseDate.length === 10 ? releaseDate : null
}

/** アルバムIDから詳細情報を取得する。トラックは50件を超える場合はページングして
 * 全件取得する(ボックスセット等、稀にありうるため)。 */
export async function fetchSpotifyAlbum(albumId: string): Promise<SpotifyAlbum | null> {
  const token = await getSpotifyAccessToken()
  const res = await fetchSpotify(`https://api.spotify.com/v1/albums/${albumId}?market=JP`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Spotify APIエラー (${res.status})`)
  }
  const data = await res.json()

  const images = (data.images ?? []) as { url: string; width: number; height: number }[]
  const imageUrl = images[0]?.url ?? null

  type RawTrack = {
    id: string
    name: string
    track_number: number
    disc_number: number
    duration_ms: number
    preview_url: string | null
  }
  const tracksRaw: RawTrack[] = data.tracks?.items ?? []
  let nextUrl: string | null = data.tracks?.next ?? null
  while (nextUrl) {
    const pageRes: Response = await fetchSpotify(nextUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!pageRes.ok) break
    const page = await pageRes.json()
    tracksRaw.push(...((page.items ?? []) as RawTrack[]))
    nextUrl = page.next ?? null
  }

  return {
    id: data.id,
    name: data.name,
    artistName: ((data.artists ?? []) as { name: string }[]).map((a) => a.name).join(', '),
    releaseDate: normalizeReleaseDate(data.release_date, data.release_date_precision),
    imageUrl,
    tracks: tracksRaw.map((t) => ({
      id: t.id,
      name: t.name,
      trackNumber: t.track_number,
      discNumber: t.disc_number,
      durationMs: t.duration_ms,
      previewUrl: t.preview_url ?? null,
    })),
  }
}
