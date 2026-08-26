'use client'

import { useState, useTransition } from 'react'
import { extractFestivalLineupCandidates, setEventImageFromUrl, type FestivalExtractResult } from '../../../actions'
import UnmatchedArtistTag from '../../../festival-pilot/UnmatchedArtistTag'

export default function FestivalLineupExtractor({
  eventId,
  eventEditionId,
}: {
  eventId: string
  eventEditionId: string
}) {
  const [result, setResult] = useState<FestivalExtractResult | null>(null)
  const [imageApplied, setImageApplied] = useState(false)
  const [imageMessage, setImageMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleExtract() {
    setResult(null)
    setImageApplied(false)
    setImageMessage(null)
    startTransition(async () => {
      const res = await extractFestivalLineupCandidates(eventId, eventEditionId)
      setResult(res)
    })
  }

  function handleUseImage(imageUrl: string) {
    startTransition(async () => {
      const res = await setEventImageFromUrl(eventId, imageUrl)
      setImageMessage(res.message)
      if (res.success) setImageApplied(true)
    })
  }

  return (
    <div className="mt-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-white/40">
          公式サイトURLから画像・出演者候補をAIで抽出します(自動登録はされません。候補を確認してから登録してください)。
        </p>
        <button
          type="button"
          onClick={handleExtract}
          disabled={isPending}
          className="shrink-0 rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
        >
          {isPending && !result ? '抽出中...' : '公式サイトからAI抽出する'}
        </button>
      </div>

      {result && !result.success && <p className="mt-2 text-xs text-red-400">{result.message}</p>}

      {result && result.success && (
        <div className="mt-3 space-y-3">
          {result.imageUrl && (
            <div className="flex items-center gap-3 rounded border border-white/10 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.imageUrl} alt="" className="h-16 w-28 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-white/40">{result.imageUrl}</p>
                {imageApplied ? (
                  <p className="text-xs text-green-400">✓ キービジュアルに設定しました</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleUseImage(result.imageUrl!)}
                    disabled={isPending}
                    className="mt-1 rounded border border-white/15 px-2 py-0.5 text-xs hover:bg-white/5 disabled:opacity-40"
                  >
                    この画像をキービジュアルにする
                  </button>
                )}
                {imageMessage && !imageApplied && <p className="mt-1 text-xs text-red-400">{imageMessage}</p>}
              </div>
            </div>
          )}

          {result.candidates.length === 0 ? (
            <p className="text-xs text-white/30">出演者候補が見つかりませんでした(JS描画のサイトでは取得できないことがあります)。</p>
          ) : (
            <div>
              <p className="text-xs text-white/40">出演者候補({result.candidates.length}件)。タップしてApple Musicと照合・登録:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.candidates.map((c, i) => (
                  <UnmatchedArtistTag
                    key={`${c.artist_name}-${i}`}
                    pick={{
                      artistName: c.artist_name,
                      datasetKey: '',
                      festivalName: result.festivalName,
                      editionYear: result.editionYear,
                      startDate: result.startDate,
                      endDate: result.endDate,
                      stage: c.stage ?? null,
                      performanceDate: null,
                      startAt: null,
                      endAt: null,
                      day: c.day_or_time_label ?? null,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
