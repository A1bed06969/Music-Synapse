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

/**
 * ブランドアイコンを持たないサービス(Amazon Music・TOWER RECORDS等)向けの
 * フォールバック。Googleのファビコン取得サービス(utils/curationSource.tsの
 * getCurationFaviconUrlと同じ仕組み)を、ハードコードしたドメイン一覧ではなく
 * リンクのURLから直接ホスト名を取って使う。URLとして不正な場合はnull。
 */
export function getFaviconUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
  } catch {
    return null
  }
}
