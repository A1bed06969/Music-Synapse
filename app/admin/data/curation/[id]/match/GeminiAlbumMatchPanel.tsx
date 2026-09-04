'use client'

import { useState, useTransition } from 'react'
import { runGeminiMatchForRankingAlbums, type GeminiAlbumMatchRankingResult } from './geminiMatchActions'

export default function GeminiAlbumMatchPanel({ rankingId, stubCount }: { rankingId: string; stubCount: number }) {
  const [result, setResult] = useState<GeminiAlbumMatchRankingResult | null>(null)
  const [isPending, startTransition] = useTransition()

  if (stubCount === 0) return null

  function handleRun() {
    startTransition(async () => {
      const r = await runGeminiMatchForRankingAlbums(rankingId)
      setResult(r)
    })
  }

  return (
    <div className="mt-6 rounded-md border border-white/15 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white/80">Geminiで自動判定</h2>
          <p className="mt-1 text-xs text-white/40">
            確信度90%以上は自動で反映、50〜89%は下の「要確認」に候補付きで並びます。
          </p>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={isPending}
          className="shrink-0 rounded border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
        >
          {isPending ? '判定中...' : `${stubCount}件を一括判定`}
        </button>
      </div>
      {result && (
        <p className="mt-2 text-xs text-white/40">
          自動反映{result.autoApplied}・要確認{result.needsReview}・該当なし{result.noMatch}
          {result.errors > 0 && <span className="text-red-400">・エラー{result.errors}</span>}
        </p>
      )}
    </div>
  )
}
