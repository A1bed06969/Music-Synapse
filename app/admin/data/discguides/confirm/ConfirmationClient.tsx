// app/admin/data/discguides/confirm/ConfirmationClient.tsx

'use client'

import { useState } from 'react'

type AlbumExtract = {
  title: string
  artist_name: string
  label?: string
  release_year?: number
}

type Candidate = {
  id: string
  title: string
  artist_name: string
}

type MatchResult = {
  extracted_index: number
  album_id?: string
  artist_id?: string
  candidates: Candidate[]
}

type PendingRecord = {
  id: string
  extracted_data: AlbumExtract[]
  matched_data: MatchResult[]
}

export default function ConfirmationClient({ pending }: { pending: PendingRecord }) {
  const extracted = pending.extracted_data ?? []
  const matched = pending.matched_data ?? []

  const [editing, setEditing] = useState<Record<number, AlbumExtract>>(
    Object.fromEntries(extracted.map((_, i) => [i, extracted[i]]))
  )
  const [selections, setSelections] = useState<Record<number, string>>(
    Object.fromEntries(matched.map((m) => [m.extracted_index, m.album_id || 'new']))
  )
  const [loading, setLoading] = useState(false)

  const handleSaveConfirmation = async () => {
    setLoading(true)
    try {
      const albums = extracted.map((_, i) => ({
        extracted_index: i,
        ...editing[i],
        album_id: selections[i] === 'new' || !selections[i] ? undefined : selections[i],
        create_new_album: selections[i] === 'new' || !selections[i],
      }))

      const response = await fetch('/api/admin/disc-guide-scan/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pending_id: pending.id,
          confirmed_data: { albums },
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        alert(`確認に失敗しました: ${body.error ?? response.status}`)
        return
      }

      // Trigger registration
      const registerRes = await fetch('/api/admin/disc-guide-scan/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_id: pending.id }),
      })

      if (!registerRes.ok) {
        const body = await registerRes.json().catch(() => ({}))
        alert(`登録に失敗しました: ${body.error ?? registerRes.status}`)
        return
      }

      const result = await registerRes.json().catch(() => ({}))
      alert(`${result.registered_count ?? 0}件のアルバムを登録しました。`)
      window.location.href = '/admin/data/discguides/confirm'
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold">アルバム確認 ({extracted.length}件)</h2>
      <div className="mt-4 space-y-4">
        {extracted.map((album, i) => {
          const match = matched.find((m) => m.extracted_index === i) ?? matched[i]
          return (
            <div key={i} className="rounded border border-white/10 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-white/40">タイトル</label>
                  <input
                    type="text"
                    value={editing[i]?.title || ''}
                    onChange={(e) =>
                      setEditing({ ...editing, [i]: { ...editing[i], title: e.target.value } })
                    }
                    className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40">アーティスト</label>
                  <input
                    type="text"
                    value={editing[i]?.artist_name || ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        [i]: { ...editing[i], artist_name: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm text-white"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs text-white/40">マッチするアルバム</label>
                <select
                  value={selections[i] || 'new'}
                  onChange={(e) => setSelections({ ...selections, [i]: e.target.value })}
                  className="mt-1 w-full rounded bg-white/5 px-2 py-1 text-sm text-white"
                >
                  <option value="new">新規作成</option>
                  {match?.candidates?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} / {c.artist_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={handleSaveConfirmation}
        disabled={loading || extracted.length === 0}
        className="mt-6 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '登録中...' : '確認して登録'}
      </button>
    </div>
  )
}
