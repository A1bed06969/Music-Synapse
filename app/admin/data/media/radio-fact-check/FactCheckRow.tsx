'use client'

import { useState, useTransition } from 'react'

/** ファクトチェック一覧の1行分。TRUEにチェックすると即座に「抽出は正しかった」を
 * 記録する。FALSEにチェックするとその場でアーティスト名・曲名を編集できるように
 * なり、「保存」で正しい値に修正しつつ「抽出は間違っていた」を記録する。 */
export default function FactCheckRow({
  pickId,
  artistName,
  trackTitle,
  factCheckedCorrect,
  markCorrectAction,
  saveCorrectionAction,
}: {
  pickId: string
  artistName: string
  trackTitle: string
  factCheckedCorrect: boolean | null
  markCorrectAction: (pickId: string) => Promise<void>
  saveCorrectionAction: (pickId: string, artistName: string, trackTitle: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [artistDraft, setArtistDraft] = useState(artistName)
  const [titleDraft, setTitleDraft] = useState(trackTitle)
  const [isPending, startTransition] = useTransition()

  const inputClass =
    'min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:border-white/30 focus:outline-none'

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
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
              await saveCorrectionAction(pickId, artistDraft, titleDraft)
              setEditing(false)
            })
          }
          className="shrink-0 text-xs text-emerald-400/80 hover:text-emerald-400 disabled:opacity-40"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => {
            setArtistDraft(artistName)
            setTitleDraft(trackTitle)
            setEditing(false)
          }}
          className="shrink-0 text-xs text-white/40 hover:text-white/70"
        >
          キャンセル
        </button>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 p-3">
      <p className="min-w-0 truncate text-sm">
        {artistName} — {trackTitle}
      </p>
      <div className="flex shrink-0 items-center gap-4 text-xs">
        <label className="flex items-center gap-1.5 text-white/60">
          <input
            type="checkbox"
            checked={factCheckedCorrect === true}
            disabled={isPending}
            onChange={() => startTransition(() => markCorrectAction(pickId))}
            className="h-4 w-4 accent-emerald-500"
          />
          TRUE
        </label>
        <label className="flex items-center gap-1.5 text-white/60">
          <input
            type="checkbox"
            checked={factCheckedCorrect === false}
            disabled={isPending}
            onChange={() => setEditing(true)}
            className="h-4 w-4 accent-red-500"
          />
          FALSE
        </label>
      </div>
    </li>
  )
}
