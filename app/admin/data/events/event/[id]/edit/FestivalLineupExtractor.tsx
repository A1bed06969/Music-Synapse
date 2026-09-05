'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { extractFestivalLineupCandidates, setEventImageFromUrl, type FestivalExtractResult } from '../../../actions'
import UnmatchedArtistTag from '../../../festival-pilot/UnmatchedArtistTag'
import { quickAddFestivalPilotDataset } from '../../../festival-pilot/actions'

export default function FestivalLineupExtractor({
  eventId,
  eventEditionId,
  initialResult = null,
  registeredArtistNames = [],
}: {
  eventId: string
  eventEditionId: string
  /** 前回このevent_editionで抽出した結果(festival_extract_pendingにキャッシュ済みのもの)。
   * 画面遷移・再読み込みで消えないよう、あればこれをそのまま初期表示に使う。 */
  initialResult?: FestivalExtractResult | null
  /** 既にこのevent_editionへ出演登録済みのアーティスト名(正規化済み、大文字化・trim済み)。
   * 再抽出しても同じ人を二重登録できてしまわないよう、該当する候補は
   * UnmatchedArtistTagの代わりに「✓ 登録済み」表示にする。 */
  registeredArtistNames?: string[]
}) {
  const [result, setResult] = useState<FestivalExtractResult | null>(initialResult)
  const registeredNameSet = new Set(registeredArtistNames)
  const [imageApplied, setImageApplied] = useState(false)
  const [imageMessage, setImageMessage] = useState<string | null>(null)
  const [pilotAdded, setPilotAdded] = useState<{ key: string; message: string } | null>(null)
  const [pilotError, setPilotError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleExtract() {
    setResult(null)
    setImageApplied(false)
    setImageMessage(null)
    setPilotAdded(null)
    setPilotError(null)
    startTransition(async () => {
      const res = await extractFestivalLineupCandidates(eventId, eventEditionId)
      setResult(res)
    })
  }

  function handleAddToPilot(eventName: string) {
    setPilotError(null)
    startTransition(async () => {
      const res = await quickAddFestivalPilotDataset(eventId, eventName)
      if (res.success) {
        setPilotAdded({ key: res.key, message: res.message })
      } else {
        setPilotError(res.message)
      }
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
            <div className="space-y-2">
              <p className="text-xs text-white/30">
                出演者候補が見つかりませんでした(JS描画のサイトでは取得できないことがあります)。
              </p>
              {pilotAdded ? (
                <p className="text-xs text-green-400">
                  ✓ {pilotAdded.message}{' '}
                  <Link
                    href={`/admin/data/events/festival-pilot?festival=${pilotAdded.key}`}
                    className="underline hover:text-green-300"
                  >
                    パイロット登録画面へ →
                  </Link>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => handleAddToPilot(result.festivalName)}
                  disabled={isPending}
                  className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
                >
                  パイロット登録に追加する(公式サイトのJSONデータ等を後で手動投入する置き場を作る)
                </button>
              )}
              {pilotError && <p className="text-xs text-red-400">{pilotError}</p>}
            </div>
          ) : (
            <div>
              <p className="text-xs text-white/40">出演者候補({result.candidates.length}件)。タップしてApple Musicと照合・登録:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.candidates.map((c) =>
                  registeredNameSet.has(c.artist_name.trim().toUpperCase()) ? (
                    <span
                      key={c.artist_name}
                      className="inline-block align-top rounded-full border border-green-500/30 bg-green-500/5 px-2 py-0.5 text-xs text-green-400"
                    >
                      ✓ {c.artist_name}(登録済み)
                    </span>
                  ) : (
                    <UnmatchedArtistTag
                      key={c.artist_name}
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
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
