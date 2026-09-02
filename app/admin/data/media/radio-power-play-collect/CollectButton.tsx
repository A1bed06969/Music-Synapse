// app/admin/data/media/radio-power-play-collect/CollectButton.tsx
//
// app/admin/data/discguides/DiscGuideDriveImport.tsxと同じパターン:
// クライアント側からAPIルートをfetchし、結果をその場に表示する
// (サーバーアクションではなくAPIルートにしているのは、このルートを
// __tests__/radio-power-play-collect.integration.test.tsから直接
// HTTPで叩いて検証できるようにするため)。
'use client'

import { useState } from 'react'

type StationResult = { station: string; extracted: number; inserted: number; error?: string }
type CollectResponse = { stations: number; totalInserted: number; results: StationResult[] }

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; data: CollectResponse }
  | { status: 'error'; message: string }

export default function CollectButton() {
  const [state, setState] = useState<State>({ status: 'idle' })

  const handleClick = async () => {
    setState({ status: 'running' })
    try {
      const res = await fetch('/api/admin/radio-power-play-collect', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState({ status: 'done', data: body })
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message })
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

      {state.status === 'error' && <p className="mt-2 text-xs text-red-400">エラー: {state.message}</p>}

      {state.status === 'done' && (
        <div className="mt-3 text-xs">
          <p className="text-green-400">
            {state.data.stations}局を処理し、新規{state.data.totalInserted}件を登録しました。
          </p>
          <ul className="mt-2 space-y-1 text-white/50">
            {state.data.results.map((r) => (
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
