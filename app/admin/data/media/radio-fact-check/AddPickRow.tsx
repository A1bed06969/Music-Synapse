'use client'

import { useState, useTransition } from 'react'

/** 自動抽出が0件だった局(または手動専用局)向けに、局サイトを見て確認した
 * 選曲をその場で追加できるようにする。追加後もボタンは再度表示されるので、
 * 複数企画(例: パワープレイ+ヘビロテ)がある局でも続けて追加できる。 */
export default function AddPickRow({
  stationName,
  region,
  monthKey,
  addAction,
}: {
  stationName: string
  region: string
  monthKey: string
  addAction: (stationName: string, region: string, monthKey: string, artistName: string, trackTitle: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [artistDraft, setArtistDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [isPending, startTransition] = useTransition()

  const inputClass =
    'min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:border-white/30 focus:outline-none'

  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="mt-1 text-xs text-white/30 hover:text-white/60">
        + 手動で追加
      </button>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-white/15 bg-white/5 p-3">
      <input
        value={artistDraft}
        onChange={(e) => setArtistDraft(e.target.value)}
        placeholder="アーティスト名"
        className={inputClass}
      />
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        placeholder="曲名"
        className={inputClass}
      />
      <button
        type="button"
        disabled={isPending || !artistDraft.trim() || !titleDraft.trim()}
        onClick={() =>
          startTransition(async () => {
            await addAction(stationName, region, monthKey, artistDraft, titleDraft)
            setArtistDraft('')
            setTitleDraft('')
            setAdding(false)
          })
        }
        className="shrink-0 text-xs text-emerald-400/80 hover:text-emerald-400 disabled:opacity-40"
      >
        追加
      </button>
      <button
        type="button"
        onClick={() => {
          setArtistDraft('')
          setTitleDraft('')
          setAdding(false)
        }}
        className="shrink-0 text-xs text-white/40 hover:text-white/70"
      >
        キャンセル
      </button>
    </li>
  )
}
