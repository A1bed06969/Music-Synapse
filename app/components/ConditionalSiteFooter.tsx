'use client'

import { usePathname } from 'next/navigation'
import SiteFooter from './SiteFooter'

/** アーティスト・アルバム・トラックの各詳細ページ、新譜カレンダー、パワープレイ&
 * ヘビロテページは独自の固定3カラムシェルを持ち、フッターをCENTERカラムの中だけに
 * 表示する — サイト全体で1回だけ描画されるこのグローバルフッターとは別に、それぞれの
 * ページ側で個別にSiteFooterを描画する(アーティストはapp/artists/[id]/layout.tsx、
 * 他はapp/components/detail/DetailPageShell.tsx)。そのためここではそれらのパス
 * 配下だけグローバル版を出さないようにする。
 * `/artists/unreleased`は静的ルート([id]の3カラムシェルを経由しない別ページ)
 * なので対象外。アルバム・トラックは動的セグメント1個の詳細ページだけが対象で、
 * `/tracks/instrument/[id]`(DetailPageShellを使わない別の詳細ページ)は除外する
 * 必要があるため、一覧ページとの前方一致ではなく「セグメントがちょうど1つ、かつ
 * 既知の非詳細パスではない」ことを正規表現で判定する。`/albums/calendar`も
 * セグメント数は1つなのでこの正規表現に自然に含まれる(2026-09-23、3カラム化に
 * 伴いDetailPageShellを使うようになったため、専用の除外は不要になった)。
 * `/media/on-air`・`/media/features`はセグメント数が2つなので上記の正規表現には
 * 含まれず、個別に除外する(2026-09-23、同じく3カラム化)。`/media/features/[id]`
 * (個別の企画詳細ページ)はまだ3カラム化していない旧レイアウトのままなので対象外。 */
export default function ConditionalSiteFooter() {
  const pathname = usePathname()
  const isArtistDetail = pathname.startsWith('/artists/') && !pathname.startsWith('/artists/unreleased')
  const isAlbumDetail = /^\/albums\/[^/]+$/.test(pathname)
  const isTrackDetail = /^\/tracks\/[^/]+$/.test(pathname) && pathname !== '/tracks/instrument'
  const isThreeColumnMediaPage = pathname === '/media/on-air' || pathname === '/media/features'
  if (isArtistDetail || isAlbumDetail || isTrackDetail || isThreeColumnMediaPage) return null
  return <SiteFooter />
}
