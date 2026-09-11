// app/components/album-detail/AlbumCenterTabs.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDuration } from '@/utils/format'
import PreviewButton from '@/app/components/PreviewButton'
import { orderAlbumTracksForMv } from '@/utils/albumMvOrder'

export type AlbumCenterTrack = {
  id: string
  disc_number: number | null
  track_no: number | null
  title: string
  duration_seconds: number | null
  preview_url: string | null
  youtube_video_id: string | null
}

/** アルバム詳細ページのCENTER。「収録曲」「MV」のタブ切替。MVタブは
 * このアルバムの収録曲のうちYouTube動画を持つものだけをサムネイルグリッドで
 * 並べ、クリックしたサムネイルをその場で埋め込み再生に差し替える(別タブ・
 * モーダルは使わない)。1件もMVが無いアルバムはタブ自体を出さず、収録曲
 * リストのみを表示する。(docs/superpowers/specs/2026-09-11-album-track-3col-design.md参照) */
export default function AlbumCenterTabs({
  tracks,
  representativeTrackId,
  albumTitle,
}: {
  tracks: AlbumCenterTrack[]
  representativeTrackId: string | null
  albumTitle: string
}) {
  const mvTracks = orderAlbumTracksForMv(tracks, representativeTrackId)
  const [tab, setTab] = useState<'tracklist' | 'mv'>('tracklist')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const showTabs = mvTracks.length > 0
  const activeTab = showTabs ? tab : 'tracklist'

  const discNumbers = Array.from(new Set(tracks.map((t) => t.disc_number ?? 1))).sort((a, b) => a - b)
  const isMultiDisc = discNumbers.length > 1

  return (
    <div>
      {showTabs && (
        <div className="flex gap-1 border-b border-white/10">
          <button
            type="button"
            onClick={() => setTab('tracklist')}
            className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] ${
              activeTab === 'tracklist' ? 'border-b-2 border-white text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            収録曲
          </button>
          <button
            type="button"
            onClick={() => setTab('mv')}
            className={`px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] ${
              activeTab === 'mv' ? 'border-b-2 border-white text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            MV
          </button>
        </div>
      )}

      {activeTab === 'tracklist' ? (
        <div className="mt-4">
          {tracks.length === 0 ? (
            <p className="text-sm text-white/40">まだトラックが登録されていません。</p>
          ) : (
            discNumbers.map((discNumber) => {
              const discTracks = tracks.filter((t) => (t.disc_number ?? 1) === discNumber)
              return (
                <div key={discNumber} className="mt-4 first:mt-0">
                  {isMultiDisc && <h3 className="text-sm font-medium text-white/50">Disc {discNumber}</h3>}
                  <ol className="divide-y divide-white/10">
                    {discTracks.map((track) => (
                      <li key={track.id} className="flex items-center gap-3 py-3 text-sm">
                        <Link
                          href={`/tracks/${track.id}`}
                          className="flex flex-1 items-center gap-4 transition hover:opacity-70"
                        >
                          <span className="w-5 shrink-0 text-right text-white/30">{track.track_no ?? '-'}</span>
                          <span className="flex-1">{track.title}</span>
                          <span className="text-white/30">{formatDuration(track.duration_seconds)}</span>
                        </Link>
                        <PreviewButton previewUrl={track.preview_url} trackId={track.id} size="sm" />
                      </li>
                    ))}
                  </ol>
                </div>
              )
            })
          )}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {mvTracks.map((track) => (
            <div key={track.id}>
              {playingId === track.id ? (
                <div className="aspect-video overflow-hidden rounded-md bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${track.youtube_video_id}?autoplay=1`}
                    title={`${albumTitle} - ${track.title}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    loading="lazy"
                    className="h-full w-full"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPlayingId(track.id)}
                  className="group block aspect-video w-full overflow-hidden rounded-md bg-white/5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${track.youtube_video_id}/hqdefault.jpg`}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </button>
              )}
              <p className="mt-1.5 truncate text-xs text-white/60">{track.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
