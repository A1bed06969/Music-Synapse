// キュレーションコンテンツ(ranking.source)の運営元サイトのドメイン。
// Googleのファビコン取得サービス(既にapp/albums/[id]/page.tsx等で使用済み)
// 経由でロゴ代わりのアイコンとして表示するために使う。
const CURATION_SOURCE_DOMAIN: Record<string, string> = {
  Fender: 'fender.com',
  'Rolling Stone Japan': 'rollingstonejapan.com',
  Spotify: 'spotify.com',
  NME: 'nme.com',
  TSUTAYA: 'tsutaya.co.jp',
  'TOWER RECORDS': 'tower.jp',
}

/** ranking.sourceからファビコンURLを引く。未知のsourceはnull(呼び出し側で
 * 🏆などの汎用アイコンにフォールバックする)。 */
export function getCurationFaviconUrl(source: string | null | undefined): string | null {
  if (!source) return null
  const domain = CURATION_SOURCE_DOMAIN[source]
  if (!domain) return null
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
}
