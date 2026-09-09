'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ArtistSectionCounts } from '@/utils/artistDetailCounts'
import { NAV_SECTIONS } from './ArtistNav'

/** Mobile用のコンパクトな2列グリッドナビゲーション。縦長の1列リストにせず、
 * 9項目を5行程度に収める(仕様: セクション「Mobile Navigation」参照)。 */
export default function ArtistNavMobile({
  artistId,
  counts,
}: {
  artistId: string
  counts: ArtistSectionCounts
}) {
  const pathname = usePathname()
  const basePath = `/artists/${artistId}`

  return (
    <nav aria-label="アーティストページ内ナビゲーション" className="mt-2">
      <div className="grid grid-cols-2 divide-x divide-y divide-white/10 border border-white/10">
        {NAV_SECTIONS.map((section) => {
          const href = `${basePath}${section.path}`
          const isActive = pathname === href
          const count = section.key === 'overview' ? null : counts[section.key]
          return (
            <Link
              key={section.key}
              href={href}
              className={`flex items-center justify-between px-3 py-2.5 text-xs ${
                isActive ? 'bg-white/5 text-white' : 'text-white/60'
              }`}
            >
              <span>
                <span className="mr-1.5 text-white/30">{section.number}</span>
                {section.label}
              </span>
              {count !== null && count > 0 && <span className="text-white/30">{count}</span>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
