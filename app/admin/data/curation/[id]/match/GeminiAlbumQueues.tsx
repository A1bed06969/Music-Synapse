'use client'

import { useState, useTransition } from 'react'
import { confirmAlbumMatchLog, revertAlbumMatchLog } from './geminiMatchActions'

export type AlbumReviewLogRow = {
  id: string
  stubTitle: string
  stubArtistName: string
  chosenTitle: string | null
  chosenArtistName: string | null
  confidence: number
  reasoning: string
  imageUrl: string | null
}

export type AlbumAutoAppliedLogRow = {
  id: string
  stubTitle: string
  stubArtistName: string
  chosenTitle: string | null
  chosenArtistName: string | null
  confidence: number
  reasoning: string
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  return <span className="shrink-0 rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">確信度{Math.round(confidence * 100)}%</span>
}

export function GeminiAlbumReviewQueue({ rows }: { rows: AlbumReviewLogRow[] }) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visible = rows.filter((r) => !resolvedIds.has(r.id))
  if (visible.length === 0) return null

  function handleConfirm(id: string) {
    setPendingId(id)
    startTransition(async () => {
      const result = await confirmAlbumMatchLog(id)
      if (result.success) {
        setResolvedIds((prev) => new Set(prev).add(id))
      } else {
        setErrorById((prev) => ({ ...prev, [id]: result.message }))
      }
      setPendingId(null)
    })
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-white/80">要確認({visible.length}件)</h2>
      <p className="mt-1 text-xs text-white/40">Geminiが選んだ候補です。合っていれば確定、違えば下の一覧から手動で選び直してください。</p>
      <ul className="mt-3 flex flex-col gap-2">
        {visible.map((r) => (
          <li key={r.id} className="rounded-md border border-white/10 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {r.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] text-white/30">?</span>
              )}
              <span className="font-medium">
                {r.stubTitle} <span className="text-white/40">/ {r.stubArtistName}</span>
              </span>
              <span className="text-white/30">→</span>
              <span>
                {r.chosenTitle} <span className="text-white/40">/ {r.chosenArtistName}</span>
              </span>
              <ConfidenceBadge confidence={r.confidence} />
              <button
                type="button"
                onClick={() => handleConfirm(r.id)}
                disabled={isPending && pendingId === r.id}
                className="ml-auto shrink-0 rounded border border-emerald-500/30 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                {isPending && pendingId === r.id ? '確定中...' : '✓ この候補で確定'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-white/40">{r.reasoning}</p>
            {errorById[r.id] && <p className="mt-1 text-xs text-red-400">{errorById[r.id]}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function GeminiAlbumAutoAppliedList({ rows }: { rows: AlbumAutoAppliedLogRow[] }) {
  const [revertedIds, setRevertedIds] = useState<Set<string>>(new Set())
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visible = rows.filter((r) => !revertedIds.has(r.id))
  if (visible.length === 0) return null

  function handleRevert(id: string) {
    setPendingId(id)
    startTransition(async () => {
      const result = await revertAlbumMatchLog(id)
      if (result.success) {
        setRevertedIds((prev) => new Set(prev).add(id))
      } else {
        setErrorById((prev) => ({ ...prev, [id]: result.message }))
      }
      setPendingId(null)
    })
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-white/80">自動反映一覧(直近{visible.length}件)</h2>
      <p className="mt-1 text-xs text-white/40">
        確信度90%以上でGeminiが自動反映したものです。間違っていれば取消できます(取消は元のスタブを再作成して未マッチに戻す形になります)。
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/15 bg-emerald-500/[0.03] px-3 py-2 text-sm">
            <span className="font-medium">
              {r.stubTitle} <span className="text-white/40">/ {r.stubArtistName}</span>
            </span>
            <span className="text-white/30">→</span>
            <span>
              {r.chosenTitle} <span className="text-white/40">/ {r.chosenArtistName}</span>
            </span>
            <ConfidenceBadge confidence={r.confidence} />
            <button
              type="button"
              onClick={() => handleRevert(r.id)}
              disabled={isPending && pendingId === r.id}
              className="ml-auto shrink-0 rounded border border-white/15 px-2.5 py-1 text-xs text-white/50 hover:bg-white/5 disabled:opacity-40"
            >
              {isPending && pendingId === r.id ? '取消中...' : '取消'}
            </button>
            {errorById[r.id] && <p className="w-full text-xs text-red-400">{errorById[r.id]}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
