'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { confirmFeaturedArtist, rejectFeaturedArtist } from './actions'

export default function FeaturedReviewRow({
  reviewId,
  artistId,
  artistName,
  trackId,
  albumId,
  appleMusicUrl,
  sourceTitle,
}: {
  reviewId: string
  artistId: string
  artistName: string
  trackId: string
  albumId: string | null
  appleMusicUrl: string | null
  sourceTitle: string
}) {
  const [done, setDone] = useState<'confirmed' | 'rejected' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleConfirm() {
    setErrorMessage(null)
    setBusy('confirm')
    startTransition(async () => {
      const result = await confirmFeaturedArtist(reviewId)
      setBusy(null)
      if (result.success) setDone('confirmed')
      else setErrorMessage(result.message)
    })
  }

  function handleReject() {
    setErrorMessage(null)
    setBusy('reject')
    startTransition(async () => {
      const result = await rejectFeaturedArtist(reviewId)
      setBusy(null)
      if (result.success) setDone('rejected')
      else setErrorMessage(result.message)
    })
  }

  if (done) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-4 py-3 text-sm text-white/40">
        <span>{artistName}</span>
        <span className={done === 'confirmed' ? 'text-green-400' : 'text-white/30'}>
          {done === 'confirmed' ? '✓ 確定しました' : '✕ 取消しました(アーティスト削除済み)'}
        </span>
      </li>
    )
  }

  return (
    <li className="rounded-md border border-white/15 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/admin/data/artists/${artistId}/edit`} className="font-medium hover:underline">
            {artistName}
          </Link>
          <p className="mt-1 truncate text-xs text-white/40">抽出元: {sourceTitle}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href={`/tracks/${trackId}`} target="_blank" className="text-blue-400 underline hover:text-blue-300">
              トラックページを見る ↗
            </Link>
            {albumId && (
              <Link href={`/albums/${albumId}`} target="_blank" className="text-blue-400 underline hover:text-blue-300">
                アルバムページを見る ↗
              </Link>
            )}
            {appleMusicUrl && (
              <a href={appleMusicUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">
                Apple Musicで検索 ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleReject}
            disabled={isPending}
            className="rounded-md border border-red-500/30 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            {isPending && busy === 'reject' ? '処理中...' : '誤抽出(取消)'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className="rounded-md border border-white/15 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
          >
            {isPending && busy === 'confirm' ? '処理中...' : '問題なし'}
          </button>
        </div>
      </div>
      {errorMessage && <p className="mt-2 text-xs text-red-400">{errorMessage}</p>}
    </li>
  )
}
