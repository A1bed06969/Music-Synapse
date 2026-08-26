'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { inputClass } from '../../adminUi'
import { saveArtistNameReading } from './actions'

export default function NameQueueRow({
  artistId,
  name,
  initialKana,
  initialEn,
}: {
  artistId: string
  name: string
  initialKana: string | null
  initialEn: string | null
}) {
  const [kana, setKana] = useState(initialKana ?? '')
  const [en, setEn] = useState(initialEn ?? '')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      const result = await saveArtistNameReading(artistId, kana, en)
      if (result.success) setSaved(true)
    })
  }

  if (saved) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-4 py-3 text-sm text-white/40">
        <span>{name}</span>
        <span className="text-green-400">✓ 確認済み{kana || en ? `(${[kana, en].filter(Boolean).join(' / ')})` : '(空欄のまま)'}</span>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-white/15 px-4 py-3 text-sm">
      <Link href={`/admin/data/artists/${artistId}/edit`} className="min-w-[10rem] font-medium hover:underline">
        {name}
      </Link>
      <input
        type="text"
        value={kana}
        onChange={(e) => setKana(e.target.value)}
        placeholder="かな読み"
        className={`${inputClass} w-40`}
      />
      <input
        type="text"
        value={en}
        onChange={(e) => setEn(e.target.value)}
        placeholder="英語/ローマ字表記"
        className={`${inputClass} w-52`}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        className="shrink-0 rounded-md border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-40"
      >
        {isPending ? '保存中...' : '保存(空欄でも確認済みにする)'}
      </button>
    </li>
  )
}
