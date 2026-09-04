'use client'

import { useState, useTransition } from 'react'
import { runGeminiMatchForRanking, type GeminiMatchRankingResult } from './geminiMatchActions'

type RankingGroup = { rankingId: string; rankingName: string; stubCount: number }

export default function GeminiMatchPanel({ groups }: { groups: RankingGroup[] }) {
  const [results, setResults] = useState<Record<string, GeminiMatchRankingResult>>({})
  const [runningId, setRunningId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (groups.length === 0) return null

  function handleRun(rankingId: string) {
    setRunningId(rankingId)
    startTransition(async () => {
      const result = await runGeminiMatchForRanking(rankingId)
      setResults((prev) => ({ ...prev, [rankingId]: result }))
      setRunningId(null)
    })
  }

  return (
    <div className="mt-6 rounded-md border border-white/15 bg-white/[0.02] p-4">
      <h2 className="text-sm font-semibold text-white/80">Geminiで自動判定</h2>
      <p className="mt-1 text-xs text-white/40">
        企画ごとに未マッチスタブをまとめて判定します。確信度90%以上は自動で紐付け、50〜89%は下の「要確認」に候補付きで並びます。
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {groups.map((g) => {
          const result = results[g.rankingId]
          return (
            <li key={g.rankingId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 px-3 py-2 text-sm">
              <span>
                {g.rankingName} <span className="text-white/30">({g.stubCount}件)</span>
              </span>
              <div className="flex items-center gap-3">
                {result && (
                  <span className="text-xs text-white/40">
                    自動反映{result.autoApplied}・要確認{result.needsReview}・該当なし{result.noMatch}
                    {result.errors > 0 && <span className="text-red-400">・エラー{result.errors}</span>}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRun(g.rankingId)}
                  disabled={isPending}
                  className="shrink-0 rounded border border-white/15 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
                >
                  {isPending && runningId === g.rankingId ? '判定中...' : 'Geminiで自動判定'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
