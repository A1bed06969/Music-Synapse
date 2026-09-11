'use client'

import { usePathname } from 'next/navigation'
import SiteFooter from './SiteFooter'

/** アーティスト・アルバム・トラックの各詳細ページは独自の固定3カラムシェルを持ち、
 * フッターをCENTERカラムの中だけに表示する — サイト全体で1回だけ描画される
 * このグローバルフッターとは別に、それぞれのページ側で個別にSiteFooterを
 * 描画する(アーティストはapp/artists/[id]/layout.tsx、アルバム・トラックは
 * app/components/detail/DetailPageShell.tsx)。そのためここではそれらのパス
 * 配下だけグローバル版を出さないようにする。
 * `/artists/unreleased`は静的ルート([id]の3カラムシェルを経由しない別ページ)
 * なので対象外。アルバム・トラックは動的セグメント1個の詳細ページだけが対象で、
 * `/albums/calendar`(専用ルート)と`/tracks/instrument/[id]`(DetailPageShellを
 * 使わない別の詳細ページ)は除外する必要があるため、一覧ページとの前方一致では
 * なく「セグメントがちょうど1つ、かつ既知の非詳細パスではない」ことを正規表現で
 * 判定する。 */
export default function ConditionalSiteFooter() {
  const pathname = usePathname()
  const isArtistDetail = pathname.startsWith('/artists/') && !pathname.startsWith('/artists/unreleased')
  const isAlbumDetail = /^\/albums\/[^/]+$/.test(pathname) && pathname !== '/albums/calendar'
  const isTrackDetail = /^\/tracks\/[^/]+$/.test(pathname) && pathname !== '/tracks/instrument'
  if (isArtistDetail || isAlbumDetail || isTrackDetail) return null
  return <SiteFooter />
}
