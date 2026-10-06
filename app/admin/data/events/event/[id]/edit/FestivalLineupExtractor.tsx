'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { extractFestivalLineupCandidates, setEventImageFromUrl, type FestivalExtractResult } from '../../../actions'
import UnmatchedArtistTag from '../../../festival-pilot/UnmatchedArtistTag'
import { quickAddFestivalPilotDataset } from '../../../festival-pilot/actions'

export default function FestivalLineupExtractor({
  eventId,
  eventEditionId,
  officialSiteUrl,
  initialResult = null,
  registeredArtistNames = [],
}: {
  eventId: string
  eventEditionId: string
  /** イベント本体の公式サイトURL(基本情報欄の値)。ラインナップページのURL入力欄の
   * placeholderとして使う(未入力ならこのURLがそのまま使われる)。 */
  officialSiteUrl?: string | null
  /** 前回このevent_editionで抽出した結果(festival_extract_pendingにキャッシュ済みのもの)。
   * 画面遷移・再読み込みで消えないよう、あればこれをそのまま初期表示に使う。 */
  initialResult?: FestivalExtractResult | null
  /** 既にこのevent_editionへ出演登録済みのアーティスト名(正規化済み、大文字化・trim済み)。
   * 再抽出しても同じ人を二重登録できてしまわないよう、該当する候補は
   * UnmatchedArtistTagの代わりに「✓ 登録済み」表示にする。 */
  registeredArtistNames?: string[]
}) {
  const [result, setResult] = useState<FestivalExtractResult | null>(initialResult)
  // 「出演を追加」等、このコンポーネントの外側のフォームを送信するとサーバー
  // アクションが同じURL(検索パラメータのみ違う)へredirectする。Next.jsの
  // App Routerはこのソフトナビゲーションではクライアントコンポーネントの
  // インスタンス(=useStateの初期値は初回マウント時のみ有効)を再利用するため、
  // 何もしないとfestival_extract_pendingに保存済みの最新の抽出結果が画面に
  // 反映されず「抽出したアーティストが全て消えた」ように見えてしまう
  // (2026-09-28ユーザー報告)。initialResultが変わった(=サーバー側で新しく
  // 読み直された)ら、レンダー中にローカル状態を追従させる(Reactの「propsが
  // 変わったらstateを調整する」推奨パターン。useEffect内でのsetStateは
  // カスケード再レンダーを招くため避け、レンダー本体で直接比較する)。
  const [prevInitialResult, setPrevInitialResult] = useState(initialResult)
  if (initialResult !== prevInitialResult) {
    setPrevInitialResult(initialResult)
    if (initialResult) setResult(initialResult)
  }
  // 公式サイトのトップページとラインナップページのURLが別なフェスが多いため
  // (例: fujirockfestival.comのトップはニュース中心、ラインナップは/artist/index)、
  // 基本情報のofficial_site_urlとは別に、抽出だけに使うURLを上書きできるようにする
  const [extractUrl, setExtractUrl] = useState('')
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
      const res = await extractFestivalLineupCandidates(eventId, eventEditionId, extractUrl.trim() || undefined)
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
      <p className="text-xs text-white/40">
        公式サイトURLから画像・出演者候補をAIで抽出します(自動登録はされません。候補を確認してから登録してください)。トップページとラインナップページが別URLのフェスも多いため、必要なら下の欄に抽出対象のURLを指定してください(空欄なら基本情報のURLを使用)。
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="url"
          value={extractUrl}
          onChange={(e) => setExtractUrl(e.target.value)}
          placeholder={officialSiteUrl ?? '抽出対象URL'}
          className="min-w-0 flex-1 rounded border border-white/15 bg-transparent px-2 py-1 text-xs text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
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

          {result.lineupImageUrl && result.candidates.length > 0 && (
            <p className="text-xs text-amber-300/80">
              ページ本文に出演者が無かったため、
              <a href={result.lineupImageUrl} target="_blank" rel="noreferrer" className="underline">
                ラインナップのポスター画像
              </a>
              からAIで読み取りました。表記ゆれ・読み間違いがないか確認してから登録してください。
            </p>
          )}

          {result.candidates.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-white/30">
                出演者候補が見つかりませんでした(本文・ポスター画像のどちらからも読み取れませんでした)。
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
                        // festival_pilot_artist_link(サイト表記→実際のartist_idの固定紐付け)に
                        // 記録を残すため、event_edition_idをdatasetKey代わりに使う。これが無いと
                        // 「既に登録済みか」の判定が名前の文字列比較(表記ゆれに弱い。例:
                        // サイト表記「平井大」 vs 実際の登録名「平井 大」)に頼るしかなく、
                        // 実際は登録済みでも再読み込みで未登録として再表示され続けていた。
                        datasetKey: eventEditionId,
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
