'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { approveCandidate, confirmEntry, rejectCandidate, removeEntry, searchTracksForCandidate, type TrackHit } from './actions'

export type ReviewItem = {
  /** 'candidate'(未確定の候補) か 'entry'(確信度の低い、反映済みの紐付け) */
  kind: 'candidate' | 'entry'
  id: string
  workTitle: string
  workType: string
  role: string | null
  songTitle: string
  artistName: string | null
  note: string | null
  sourceUrl: string
  reason: string | null
  /** 自動で選ばれた(または反映された)曲 */
  suggested: { id: string; title: string; artist: string | null; album: string | null } | null
}

const TYPE_LABEL: Record<string, string> = { anime: 'アニメ', drama: 'ドラマ', movie: '映画', game: 'ゲーム', cm: 'CM', tv_program: 'テレビ番組' }
const small = 'rounded-md border border-white/20 px-3 py-1.5 text-xs font-bold transition hover:bg-white/10 disabled:opacity-40'

export default function ReviewRow({ item }: { item: ReviewItem }) {
  const [done, setDone] = useState<string | null>(null)
  const [query, setQuery] = useState(item.songTitle)
  const [hits, setHits] = useState<TrackHit[] | null>(null)
  const [pending, start] = useTransition()

  if (done) {
    return <li className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-white/40">{item.workTitle} 「{item.songTitle}」 — {done}</li>
  }

  const act = (fn: () => Promise<unknown>, message: string) =>
    start(async () => {
      await fn()
      setDone(message)
    })

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-fuchsia-300/50 px-2 py-0.5 font-black text-fuchsia-300">{TYPE_LABEL[item.workType] ?? item.workType}</span>
        <span className="font-bold text-white/80">{item.workTitle}</span>
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-white/30 underline hover:text-white/60">
          出典
        </a>
      </div>
      <p className="mt-2 text-base font-bold">
        {item.role && <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-black text-fuchsia-300">{item.role}</span>}
        「{item.songTitle}」<span className="ml-2 text-sm font-normal text-white/60">{item.artistName ?? '(歌い手の記載なし)'}</span>
      </p>
      {item.note && <p className="text-xs text-white/40">{item.note}</p>}
      {item.reason && <p className="mt-1 text-xs text-amber-300/80">{item.reason}</p>}

      {item.suggested && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-black/30 p-2 text-sm">
          <span className="text-[11px] text-white/40">{item.kind === 'entry' ? '紐付いている曲' : '自動で選ばれた曲'}</span>
          <Link href={`/tracks/${item.suggested.id}`} target="_blank" className="font-bold hover:underline">
            {item.suggested.title}
          </Link>
          <span className="text-xs text-white/50">
            {item.suggested.artist} ・ {item.suggested.album}
          </span>
          {item.kind === 'candidate' ? (
            <button type="button" disabled={pending} className={`${small} border-emerald-400/50 text-emerald-300`} onClick={() => act(() => approveCandidate(item.id, item.suggested!.id), '紐付けました')}>
              この曲で確定
            </button>
          ) : (
            <>
              <button type="button" disabled={pending} className={`${small} border-emerald-400/50 text-emerald-300`} onClick={() => act(() => confirmEntry(item.id), '確認済みにしました')}>
                OK(確認済み)
              </button>
              <button type="button" disabled={pending} className={`${small} border-red-400/50 text-red-300`} onClick={() => act(() => removeEntry(item.id), '紐付けを外しました')}>
                外す
              </button>
            </>
          )}
        </div>
      )}

      {item.kind === 'candidate' && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="曲名で探す"
              className="min-w-[200px] flex-1 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-white/30 focus:outline-none"
            />
            <button type="button" disabled={pending} className={small} onClick={() => start(async () => setHits(await searchTracksForCandidate(query, item.artistName ?? undefined)))}>
              カタログから探す
            </button>
            <button type="button" disabled={pending} className={`${small} border-red-400/40 text-red-300`} onClick={() => act(() => rejectCandidate(item.id), '却下しました')}>
              却下
            </button>
          </div>
          {hits && (
            <ul className="mt-2 divide-y divide-white/5 rounded-md border border-white/10">
              {hits.length === 0 && <li className="px-3 py-2 text-xs text-white/40">カタログに該当する曲がありません。</li>}
              {hits.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
                    {h.jacketUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.jacketUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{h.title}</span>
                    <span className="block truncate text-xs text-white/50">
                      {h.artist} ・ {h.album} {h.releaseDate ? `(${h.releaseDate.slice(0, 4)})` : ''}
                    </span>
                  </span>
                  <button type="button" disabled={pending} className={`${small} border-emerald-400/50 text-emerald-300`} onClick={() => act(() => approveCandidate(item.id, h.id), '紐付けました')}>
                    これに紐付ける
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
