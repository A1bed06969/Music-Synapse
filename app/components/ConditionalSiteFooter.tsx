'use client'

import { usePathname } from 'next/navigation'
import SiteFooter from './SiteFooter'

/** アーティスト詳細ページ(/artists/[id]/*)は独自の固定3カラムシェルを持ち、
 * フッターをCENTERカラムの中だけに(page.tsxが渡すchildrenの一部として)表示する
 * — サイト全体で1回だけ描画されるこのグローバルフッターとは別に、
 * app/artists/[id]/layout.tsx側で個別にSiteFooterを描画する。そのため
 * ここではそのパス配下だけグローバル版を出さないようにする。
 * `/artists/unreleased`は静的ルート([id]の3カラムシェルを経由しない別ページ)
 * なので対象外。 */
export default function ConditionalSiteFooter() {
  const pathname = usePathname()
  const isArtistDetail = pathname.startsWith('/artists/') && !pathname.startsWith('/artists/unreleased')
  if (isArtistDetail) return null
  return <SiteFooter />
}
