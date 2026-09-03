// utils/spotify.ts
//
// Apple Musicのカタログに無いがSpotifyには存在するアルバム(インディー/海外の
// レア盤等)を、SpotifyのアルバムURLから直接取り込むためのクライアント。
// Client Credentials方式(サーバー間認証のみ、ユーザー認可不要)で完結する
// 範囲に限定する。認証仕様はdocs/superpowers/specs/2026-08-07-
// spotify-artist-images-design.mdで事前調査済みのものを踏襲。

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
  const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}?market=JP`, {
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
    const pageRes: Response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } })
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
