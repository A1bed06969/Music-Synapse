'use client'

import { useState, useTransition } from 'react'
import { revertBioGeneration } from './actions'

export type BioGenerationLogRow = {
  id: string
  artistId: string
  artistName: string
  sourceType: 'article_context' | 'wikidata'
  generatedBio: string
  createdAt: string
}

export default function BioGenerationList({ rows }: { rows: BioGenerationLogRow[] }) {
  const [revertedIds, setRevertedIds] = useState<Set<string>>(new Set())
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const visible = rows.filter((r) => !revertedIds.has(r.id))
  if (visible.length === 0) {
    return <p className="mt-8 text-sm text-white/40">生成済みの紹介文はありません。</p>
  }

  function handleRevert(id: string) {
    setPendingId(id)
    startTransition(async () => {
      const result = await revertBioGeneration(id)
      if (result.success) {
        setRevertedIds((prev) => new Set(prev).add(id))
      } else {
        setErrorById((prev) => ({ ...prev, [id]: result.message }))
      }
      setPendingId(null)
    })
  }

  return (
    <ul className="mt-4 flex flex-col gap-3">
      {visible.map((r) => (
        <li key={r.id} className="rounded-md border border-white/10 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/artists/${r.artistId}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              {r.artistName}
            </a>
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              {r.sourceType === 'article_context' ? '記事抽出テキスト' : 'Wikipedia'}
            </span>
            <span className="text-[10px] text-white/30">{new Date(r.createdAt).toLocaleString('ja-JP')}</span>
            <button
              type="button"
              onClick={() => handleRevert(r.id)}
              disabled={isPending && pendingId === r.id}
              className="ml-auto shrink-0 rounded border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              {isPending && pendingId === r.id ? '取消中...' : '取り消す'}
            </button>
          </div>
          <p className="mt-2 text-white/70">{r.generatedBio}</p>
          {errorById[r.id] && <p className="mt-1 text-xs text-red-400">{errorById[r.id]}</p>}
        </li>
      ))}
    </ul>
  )
}
