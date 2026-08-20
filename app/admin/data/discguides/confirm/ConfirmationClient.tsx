// app/admin/data/discguides/confirm/ConfirmationClient.tsx

'use client'

import { useState } from 'react'
import SearchableSelect from '../../SearchableSelect'
import { searchAppleMusicAlbums } from './actions'

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
  // 既存の確認待ちレコード(similarity追加前に保存されたもの)には無い可能性が
  // あるため任意。無い場合は未確認扱い(=要確認)にするのが安全なデフォルト。
  similarity?: number
}

// 実データでの実測値: 正しいマッチ(表記ゆれ込み)は0.79〜1.0、無関係なマッチは
// 0.15〜0.17前後まで下がる。0.5を「要確認」の境界にする。
const CONFIDENCE_THRESHOLD = 0.5

function isSuspiciousMatch(candidates: Candidate[] | undefined): boolean {
  const top = candidates?.[0]
  if (!top) return true
  return (top.similarity ?? 0) < CONFIDENCE_THRESHOLD
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
  // 自動マッチング候補が0件、または最有力候補の類似度が低い行(=要確認)は
  // デフォルトで検索欄を開いておく。
  const [manualSearchOpen, setManualSearchOpen] = useState<Record<number, boolean>>(
    Object.fromEntries(
      matched.map((m) => [m.extracted_index, isSuspiciousMatch(m.candidates)])
    )
  )
  const [loading, setLoading] = useState(false)
  const [registeredRows, setRegisteredRows] = useState<Record<number, boolean>>({})
  const [registeringRow, setRegisteringRow] = useState<number | null>(null)
  const [rowError, setRowError] = useState<Record<number, string>>({})

  const buildAlbumPayload = (i: number) => ({
    extracted_index: i,
    ...editing[i],
    album_id: selections[i] === 'new' || !selections[i] ? undefined : selections[i],
    create_new_album: selections[i] === 'new' || !selections[i],
  })

  const handleRegisterOne = async (i: number) => {
    setRegisteringRow(i)
    setRowError({ ...rowError, [i]: '' })
    try {
      const res = await fetch('/api/admin/disc-guide-scan/register-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_id: pending.id, album: buildAlbumPayload(i) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowError({ ...rowError, [i]: body.error ?? `HTTP ${res.status}` })
        return
      }
      setRegisteredRows({ ...registeredRows, [i]: true })
    } finally {
      setRegisteringRow(null)
    }
  }

  const handleSaveConfirmation = async () => {
    setLoading(true)
    try {
      const albums = extracted.map((_, i) => buildAlbumPayload(i))

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

      // 登録処理はバックグラウンドで進む(件数が多いページだと同期的に待つと
      // タイムアウトすることが実際にあったため)。完了を待たずに結果を知らせる。
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

      alert('登録処理を開始しました。数秒〜数十秒ほどでディスクガイド管理ページに反映されます。')
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
          const isSuspicious = isSuspiciousMatch(match?.candidates)
          const hasWeakCandidates = isSuspicious && (match?.candidates?.length ?? 0) > 0
          const searchOpen = manualSearchOpen[i] ?? isSuspicious
          return (
            <div
              key={i}
              className={`rounded border p-4 ${
                isSuspicious ? 'border-orange-500/40 bg-orange-500/5' : 'border-white/10'
              }`}
            >
              {isSuspicious && (
                <p className="mb-2 text-xs font-semibold text-orange-400">
                  ⚠ 要確認 —{' '}
                  {hasWeakCandidates
                    ? '自動マッチング候補の確度が低いです。手動で検索してください。'
                    : '自動マッチング候補が見つかりませんでした。手動で検索してください。'}
                </p>
              )}
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
                      {c.similarity !== undefined ? ` (一致度${Math.round(c.similarity * 100)}%)` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setManualSearchOpen({ ...manualSearchOpen, [i]: !searchOpen })}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {searchOpen ? '手動検索を閉じる' : '他のアルバムを検索'}
                </button>
                {searchOpen && (
                  <div className="mt-2">
                    <SearchableSelect
                      searchAction={searchAppleMusicAlbums}
                      name={`manual_search_${i}`}
                      placeholder="アルバム名で検索(Apple Musicカタログ全体)..."
                      onSelect={(item) =>
                        setSelections({ ...selections, [i]: item ? item.id : 'new' })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-3">
                {registeredRows[i] ? (
                  <span className="text-xs font-semibold text-green-400">✓ 登録済み</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRegisterOne(i)}
                    disabled={registeringRow === i}
                    className="rounded bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
                  >
                    {registeringRow === i ? '登録中...' : 'この1件を登録'}
                  </button>
                )}
                {rowError[i] && <span className="text-xs text-red-400">{rowError[i]}</span>}
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
