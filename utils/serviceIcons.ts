import {
  siApplemusic,
  siSpotify,
  siX,
  siInstagram,
  siFacebook,
  siTiktok,
  siYoutube,
  siYoutubemusic,
  siDiscogs,
  siWikidata,
  siImdb,
  siSoundcloud,
  siTidal,
  siLine,
} from 'simple-icons'

export type ServiceIcon = {
  title: string
  hex: string
  path: string
}

// artist_external_link の URL ホスト名 -> ブランドアイコン。
// simple-icons に存在しないサービス(AllMusic・Qobuz・Amazon Music・AWA等)は
// このマップに含めず、呼び出し側で汎用フォールバックアイコンを使う。
const HOSTNAME_ICON: Record<string, ServiceIcon> = {
  'music.apple.com': siApplemusic,
  'open.spotify.com': siSpotify,
  'x.com': siX,
  'twitter.com': siX,
  'instagram.com': siInstagram,
  'facebook.com': siFacebook,
  'tiktok.com': siTiktok,
  'music.youtube.com': siYoutubemusic,
  'youtube.com': siYoutube,
  'discogs.com': siDiscogs,
  'wikidata.org': siWikidata,
  'imdb.com': siImdb,
  'soundcloud.com': siSoundcloud,
  'tidal.com': siTidal,
  'line.me': siLine,
}

// Material Symbols "link"(Apache-2.0)。ブランドアイコンが無いサービス用の
// 汎用フォールバックアイコン。
export const GENERIC_LINK_ICON_PATH =
  'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z'

/**
 * URLのホスト名からブランドアイコンを引く。サブドメイン(例: open.spotify.com
 * の www. 等)や末尾一致も許容する。マッチしない場合、またはURLとして不正な
 * 場合は null を返す(呼び出し側で汎用フォールバックアイコンを使う)。
 */
export function getServiceIcon(url: string): ServiceIcon | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    if (HOSTNAME_ICON[hostname]) return HOSTNAME_ICON[hostname]
    for (const [domain, icon] of Object.entries(HOSTNAME_ICON)) {
      if (hostname.endsWith(`.${domain}`)) return icon
    }
    return null
  } catch {
    return null
  }
}
