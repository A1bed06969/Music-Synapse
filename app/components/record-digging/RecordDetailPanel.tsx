'use client'

import { useEffect, useState } from 'react'
import { siDiscogs } from 'simple-icons'
import ArtistLinkIcons from '@/app/components/ArtistLinkIcons'
import type { DiggingRecord, DiggingShelf, RecordDetail } from '@/utils/recordDigging'

/** デスクトップ右側の「現在再生中」情報パネル。棚のスワイプ本体には不要な
 * 詳細(レーベル・カタログ番号・外部リンク)を、現在のレコードが変わる
 * たびに個別に取得して表示する。データが無い項目は表示しない
 * (「情報が揃っていなくても、入っている情報だけ表示する」方針)。 */
export default function RecordDetailPanel({ current, shelf }: { current: DiggingRecord; shelf: DiggingShelf | undefined }) {
  const [detail, setDetail] = useState<RecordDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    fetch(`/api/record-digging/record-detail?albumId=${encodeURIComponent(current.id)}&artistId=${encodeURIComponent(current.artistId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RecordDetail | null) => {
        if (!cancelled) setDetail(data)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
    return () => {
      cancelled = true
    }
  }, [current.id, current.artistId])

  const year = current.releaseDate ? current.releaseDate.slice(0, 4) : null

  return (
    <div className="flex h-full flex-col justify-center gap-4 rounded-lg border border-white/10 bg-white/[0.02] p-5">
      <div>
        <p className="text-lg font-bold text-white">{current.artistName}</p>
        <p className="text-sm text-white/60">{current.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/35">
          {year && <span>{year}</span>}
          {shelf?.isGenre && (
            <>
              <span className="text-white/15">/</span>
              <span>{shelf.label}</span>
            </>
          )}
        </div>
      </div>

      {detail && (detail.labelName || detail.catalogNumber) && (
        <div className="space-y-0.5 text-xs text-white/40">
          {detail.labelName && (
            <p>
              Label <span className="text-white/60">{detail.labelName}</span>
            </p>
          )}
          {detail.catalogNumber && (
            <p>
              Catalog <span className="text-white/60">{detail.catalogNumber}</span>
            </p>
          )}
        </div>
      )}

      {detail && (
        <div>
          <ArtistLinkIcons
            artistName={detail.artistName}
            officialSiteUrl={detail.officialSiteUrl}
            snsXUrl={detail.snsXUrl}
            snsInstagramUrl={detail.snsInstagramUrl}
            appleMusicArtistId={detail.appleMusicArtistId}
            spotifyArtistId={detail.spotifyArtistId}
            externalLinks={detail.externalLinks}
          />
          {detail.discogsUrl && (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-white/40">Discogs</p>
              <a
                href={detail.discogsUrl}
                target="_blank"
                rel="noreferrer"
                title="Discogs"
                aria-label="Discogs"
                className="mt-2 flex h-9 w-9 items-center justify-center rounded-xl transition hover:opacity-80"
                style={{ backgroundColor: `#${siDiscogs.hex}` }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff">
                  <path d={siDiscogs.path} />
                </svg>
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
