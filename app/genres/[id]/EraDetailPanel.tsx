'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { EraCardData } from '@/utils/genreHistory'

function Thumb({ src, alt, shape }: { src: string | null; alt: string; shape: 'circle' | 'square' }) {
  const [loadFailed, setLoadFailed] = useState(false)
  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-md'

  if (!src || loadFailed) {
    return (
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center border border-white/10 bg-white/[0.03] text-xs font-bold text-white/20 ${shapeClass}`}
      >
        {alt.slice(0, 1)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={() => setLoadFailed(true)} className={`h-10 w-10 shrink-0 object-cover ${shapeClass}`} />
  )
}

/** CORE(そのジャンルを直接形成した) / INFLUENCE(語法・精神を取り入れているが
 * 正式なサブジャンルではない) / APPROACH(演奏法やDIY精神など一部だけを部分的に
 * 継承する) を、GENRE EVOLUTIONの凡例と同じ実線/点線/破線の語彙で示す。 */
function ClassificationBadge({ classification }: { classification: 'core' | 'influence' | 'approach' }) {
  const styleByClassification: Record<'core' | 'influence' | 'approach', { border: string; text: string; label: string }> = {
    core: { border: 'border-white/20', text: 'text-white/50', label: 'Core' },
    influence: { border: 'border-dotted border-white/20', text: 'text-white/35', label: 'Influence' },
    approach: { border: 'border-dashed border-white/20', text: 'text-white/35', label: 'Approach' },
  }
  const { border, text, label } = styleByClassification[classification]
  return <span className={`rounded border ${border} px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${text}`}>{label}</span>
}

function AlbumTypeBadge({ albumType }: { albumType: string | null }) {
  if (!albumType) return null
  return <span className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/40">{albumType}</span>
}

export default function EraDetailPanel({ card }: { card: EraCardData }) {
  return (
    <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.02] p-6 animate-[fadein_0.2s_ease-in]">
      <p className="text-xs uppercase tracking-wide text-white/40">選択中</p>
      <h2 className="mt-1 text-lg font-bold">
        {card.period} ・ {card.title}
        {card.region && <span className="ml-2 text-sm font-normal text-white/40">{card.region}</span>}
      </h2>

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">歴史・出来事</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            {card.description ?? 'まだ解説が登録されていません。'}
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">代表アーティスト</h3>
          {card.representativeArtists.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">まだ登録されていません。</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {card.representativeArtists.map((artist) => (
                <li key={artist.id} className="flex gap-2">
                  <Thumb src={artist.imageUrl} alt={artist.name} shape="circle" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/artists/${artist.id}`} className="text-sm text-white/80 hover:text-white hover:underline">
                        {artist.name}
                      </Link>
                      <ClassificationBadge classification={artist.classification} />
                    </div>
                    {artist.nameSecondary && <p className="text-xs text-white/40">{artist.nameSecondary}</p>}
                    {artist.note && <p className="mt-0.5 text-xs leading-snug text-white/50">{artist.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">代表作品</h3>
          {card.representativeWorks.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">まだ登録されていません。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {card.representativeWorks.map((work) => (
                <li key={work.id} className="flex items-center gap-2">
                  <Thumb src={work.imageUrl} alt={work.title} shape="square" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/albums/${work.id}`} className="text-sm text-white/80 hover:text-white hover:underline">
                        {work.artistName ? `${work.artistName}「${work.title}」` : `「${work.title}」`}
                      </Link>
                      <AlbumTypeBadge albumType={work.albumType} />
                    </span>
                    {work.year && <span className="text-xs text-white/40">{work.year}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
