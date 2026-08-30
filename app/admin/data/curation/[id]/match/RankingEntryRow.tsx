'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import AlbumCandidatePicker from '../../../discguides/confirm/AlbumCandidatePicker'
import { linkRankingEntryCandidate } from './actions'

type Candidate = { id: string; title: string; artist_name: string; similarity?: number; artwork_url?: string }

export default function RankingEntryRow({
  rankingId,
  entryId,
  artistName,
  title,
  oldAlbumId,
  oldArtistId,
  candidates,
  defaultCandidateId,
}: {
  rankingId: string
  entryId: number
  artistName: string
  title: string
  oldAlbumId: string | null
  oldArtistId: string | null
  candidates: Candidate[]
  defaultCandidateId: string
}) {
  const [selection, setSelection] = useState(defaultCandidateId)
  const [savedAlbumId, setSavedAlbumId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (savedAlbumId) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-400">
        <span>✓ {artistName} / {title} を登録しました。</span>
        <Link href={`/albums/${savedAlbumId}`} className="text-xs text-emerald-300 hover:text-emerald-200">
          アルバムを見る →
        </Link>
      </li>
    )
  }

  return (
    <li className="rounded-md border border-white/10 p-3">
      <p className="text-sm font-medium">
        {artistName} / {title}
      </p>
      <div className="mt-2 max-w-md">
        <AlbumCandidatePicker candidates={candidates} value={selection} onChange={setSelection} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={selection === 'new' || isPending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const result = await linkRankingEntryCandidate(rankingId, entryId, oldAlbumId, oldArtistId, selection)
              if (result.success) {
                setSavedAlbumId(result.albumId ?? selection)
              } else {
                setError(result.message)
              }
            })
          }}
          className="rounded bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-40"
        >
          {isPending ? '登録中...' : 'この候補で登録'}
        </button>
        {selection === 'new' && <span className="text-xs text-white/30">候補を選ぶと登録できます</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {oldAlbumId && (
        <div className="mt-2 flex flex-wrap gap-3">
          <span className="text-xs text-white/30">候補に無い場合(旧譜・限定盤など):</span>
          <Link
            href={`/admin/data/albums/${oldAlbumId}/tower-lookup?from=${encodeURIComponent(`/admin/data/curation/${rankingId}/match`)}`}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Tower Recordsから取込 →
          </Link>
          <Link
            href={`/admin/data/albums/${oldAlbumId}/discogs-lookup?from=${encodeURIComponent(`/admin/data/curation/${rankingId}/match`)}`}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Discogsから取込 →
          </Link>
        </div>
      )}
    </li>
  )
}
