'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ArtistSectionCounts } from '@/utils/artistDetailCounts'

export type NavSection = {
  number: string
  key: keyof ArtistSectionCounts | 'overview'
  label: string
  path: string // artistIdの後に続くパス。空文字はOverview(index)。
}

export const NAV_SECTIONS: NavSection[] = [
  { number: '01', key: 'overview', label: 'OVERVIEW', path: '' },
  { number: '02', key: 'discography', label: 'DISCOGRAPHY', path: '/discography' },
  { number: '03', key: 'timeline', label: 'TIMELINE', path: '/timeline' },
  { number: '04', key: 'live', label: 'FESTIVAL & LIVE', path: '/live' },
  { number: '05', key: 'network', label: 'NETWORK', path: '/network' },
  { number: '06', key: 'media', label: 'MEDIA', path: '/media' },
  { number: '07', key: 'ranking', label: 'RANKING', path: '/ranking' },
  { number: '08', key: 'awards', label: 'AWARDS', path: '/awards' },
  { number: '09', key: 'radio', label: 'RADIO ROTATION', path: '/radio' },
]

/** RIGHTカラムのArtist Navigation。Editorial Index形式(Number・Label・Countのみ、
 * 大きなボタンにしない)。アクティブ項目はアクセントラインで表現する。
 * mediaのカウントは呼び出し元(各page.tsx)が実際に計算した値を渡すまで0のままで、
 * Overview/Discography等の別セクション閲覧中はこの値のまま(目安値の性質上、
 * 他セクションで最新化する必要はない)。 */
export default function ArtistNav({
  artistId,
  counts,
}: {
  artistId: string
  counts: ArtistSectionCounts
}) {
  const pathname = usePathname()
  const basePath = `/artists/${artistId}`

  return (
    <nav aria-label="アーティストページ内ナビゲーション">
      <p className="text-xs uppercase tracking-wide text-white/40">Artist</p>
      <ul className="mt-3 flex flex-col gap-3 lg:grid-cols-1">
        {NAV_SECTIONS.map((section) => {
          const href = `${basePath}${section.path}`
          const isActive = pathname === href
          const count = section.key === 'overview' ? null : counts[section.key]
          return (
            <li key={section.key}>
              <Link
                href={href}
                className={`flex items-baseline gap-2 border-l-2 py-1 pl-3 text-sm transition ${
                  isActive
                    ? 'border-white text-white'
                    : 'border-transparent text-white/50 hover:border-white/30 hover:text-white/80'
                }`}
              >
                <span className="text-[10px] text-white/30">{section.number}</span>
                <span className="tracking-wide">{section.label}</span>
                {count !== null && count > 0 && <span className="ml-auto text-xs text-white/30">{count}</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
