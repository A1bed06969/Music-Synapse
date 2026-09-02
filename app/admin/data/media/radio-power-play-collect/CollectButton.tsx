// app/admin/data/media/radio-power-play-collect/CollectButton.tsx
//
// app/admin/data/discguides/DiscGuideDriveImport.tsxと同じパターン:
// クライアント側からAPIルートをfetchし、結果をその場に表示する
// (サーバーアクションではなくAPIルートにしているのは、このルートを
// __tests__/radio-power-play-collect.integration.test.tsから直接
// HTTPで叩いて検証できるようにするため)。
//
// 局数が多く(2026-09時点で50局超)、Gemini無料枠のレート制限に収まる間隔を
// 空けると1リクエストでは処理しきれずVercelのタイムアウトに達するため、
// APIルート側がoffset/limitでバッチ処理する設計になっている。このボタンは
// 全局終わるまで(nextOffsetがnullになるまで)繰り返し呼び出し、結果を
// 積み上げて表示する。
'use client'

import { useState } from 'react'

type StationResult = { station: string; extracted: number; inserted: number; error?: string }
type CollectResponse = {
  stations: number
  processed: number
  nextOffset: number | null
  totalInserted: number
  results: StationResult[]
}

type State =
  | { status: 'idle' }
  | { status: 'running'; processedSoFar: number; total: number }
  | { status: 'done'; stations: number; totalInserted: number; results: StationResult[] }
  | { status: 'error'; message: string; processedSoFar: number; total: number; results: StationResult[] }

export default function CollectButton() {
  const [state, setState] = useState<State>({ status: 'idle' })

  const handleClick = async () => {
    setState({ status: 'running', processedSoFar: 0, total: 0 })

    let offset = 0
    let processedSoFar = 0
    let total = 0
    let totalInserted = 0
    const allResults: StationResult[] = []

    while (true) {
      try {
        const res = await fetch(`/api/admin/radio-power-play-collect?offset=${offset}`, { method: 'POST' })
        const body: CollectResponse = await res.json()
        if (!res.ok) throw new Error((body as unknown as { error?: string }).error ?? `HTTP ${res.status}`)

        total = body.stations
        processedSoFar += body.processed
        totalInserted += body.totalInserted
        allResults.push(...body.results)
        setState({ status: 'running', processedSoFar, total })

        if (body.nextOffset === null) {
          setState({ status: 'done', stations: total, totalInserted, results: allResults })
          return
        }
        offset = body.nextOffset
      } catch (err) {
        setState({ status: 'error', message: (err as Error).message, processedSoFar, total, results: allResults })
        return
      }
    }
  }

  const isBusy = state.status === 'running'

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={isBusy}
        className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {isBusy ? '収集中...(数分かかる場合があります)' : '今すぐ全局を収集する'}
      </button>

      {state.status === 'running' && state.total > 0 && (
        <p className="mt-2 text-xs text-white/50">
          収集中: {state.processedSoFar}/{state.total}局(このタブを開いたままにしてください)
        </p>
      )}

      {state.status === 'error' && (
        <p className="mt-2 text-xs text-red-400">
          エラー: {state.message}({state.processedSoFar}/{state.total}局まで処理済み。もう一度押すと再試行できます。
          既に処理済みの局は重複登録されません)
        </p>
      )}

      {(state.status === 'done' || state.status === 'error') && state.results.length > 0 && (
        <div className="mt-3 text-xs">
          {state.status === 'done' && (
            <p className="text-green-400">
              {state.stations}局を処理し、新規{state.totalInserted}件を登録しました。
            </p>
          )}
          <ul className="mt-2 space-y-1 text-white/50">
            {state.results.map((r) => (
              <li key={r.station}>
                {r.station}: 抽出{r.extracted}件 / 新規{r.inserted}件
                {r.error && <span className="text-red-400"> — エラー: {r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
