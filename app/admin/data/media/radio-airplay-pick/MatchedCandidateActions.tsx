'use client'

import { useState } from 'react'
import RadioPickMatcher from './RadioPickMatcher'

/** マッチ済み・未登録タブの1行分の操作。自動マッチングの候補が間違っている
 * 場合(例: アーティスト名の一部が別の曲名と偶然一致してしまった等)に、
 * 一度「解除」してタブを移動しなくても、その場で検索し直して候補を
 * 直接差し替えられるようにする(「修正」ボタンでRadioPickMatcherの検索欄を
 * 表示する。中身は未マッチタブと同じ検索UI)。 */
export default function MatchedCandidateActions({
  pickId,
  albumMode,
  candidateLabel,
  candidateArtworkUrl,
  registerAction,
  clearAction,
}: {
  pickId: string
  albumMode: boolean
  candidateLabel: string
  candidateArtworkUrl: string | null
  registerAction: (formData: FormData) => void
  clearAction: (formData: FormData) => void
}) {
  const [fixing, setFixing] = useState(false)

  if (fixing) {
    return (
      <div className="flex w-full max-w-sm items-start gap-2">
        <div className="flex-1">
          <RadioPickMatcher pickId={pickId} albumMode={albumMode} />
        </div>
        <button
          type="button"
          onClick={() => setFixing(false)}
          className="shrink-0 pt-2 text-xs text-white/40 hover:text-white/70"
        >
          キャンセル
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-xs text-white/60">
        {candidateArtworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={candidateArtworkUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
        )}
        <span className="max-w-[220px] truncate">{candidateLabel}</span>
      </div>
      <form action={registerAction}>
        <input type="hidden" name="pick_id" value={pickId} />
        <button type="submit" className="shrink-0 text-xs text-emerald-400/80 hover:text-emerald-400">
          登録
        </button>
      </form>
      <button
        type="button"
        onClick={() => setFixing(true)}
        className="shrink-0 text-xs text-amber-400/80 hover:text-amber-400"
      >
        修正
      </button>
      <form action={clearAction}>
        <input type="hidden" name="id" value={pickId} />
        <button type="submit" className="shrink-0 text-xs text-red-400/70 hover:text-red-400">
          解除
        </button>
      </form>
    </div>
  )
}
