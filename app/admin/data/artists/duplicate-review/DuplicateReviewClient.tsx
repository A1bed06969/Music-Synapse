'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { mergeArtists, markGroupAsConfirmedSeparate } from './actions'

export type DuplicateCandidate = {
  id: string
  appleMusicArtistId: string | null
  createdAt: string
  albumCount: number
  trackCount: number
  sampleAlbumTitle: string | null
  sampleAlbumJacketUrl: string | null
}

export type DuplicateGroup = {
  name: string
  candidates: DuplicateCandidate[]
}

/** 同名だがapple_music_artist_idが複数種類あるため自動統合できなかったartistの
 * 手動レビュー画面。カードごとにチェックした候補を「統合」(1件に集約)するか
 * 「別人として確定」(以後のレビュー対象から除外)するかを選ぶ
 * (2026-09-23、syncOneAlbumの重複登録バグの後始末として追加)。 */
export default function DuplicateReviewClient({ groups: initialGroups }: { groups: DuplicateGroup[] }) {
  const [groups, setGroups] = useState(initialGroups)
  const [checkedByGroup, setCheckedByGroup] = useState<Record<string, Set<string>>>({})
  const [keeperByGroup, setKeeperByGroup] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function toggleCheck(groupName: string, candidateId: string) {
    setCheckedByGroup((prev) => {
      const current = new Set(prev[groupName] ?? [])
      if (current.has(candidateId)) current.delete(candidateId)
      else current.add(candidateId)
      return { ...prev, [groupName]: current }
    })
  }

  // 統合先(残す側)を選ぶ。「これを残す」はどの候補にも常時表示し、選んだ時点で
  // その候補も自動的にチェック済みにする(統合先自身が未チェックだと「統合先が
  // どれか画面上わからない」まま統合されてしまうユーザー報告を受けての修正、
  // 2026-09-25)。
  function selectKeeper(groupName: string, candidateId: string) {
    setKeeperByGroup((prev) => ({ ...prev, [groupName]: candidateId }))
    setCheckedByGroup((prev) => {
      const current = new Set(prev[groupName] ?? [])
      current.add(candidateId)
      return { ...prev, [groupName]: current }
    })
  }

  function removeGroup(groupName: string) {
    setGroups((prev) => prev.filter((g) => g.name !== groupName))
  }

  function handleMerge(group: DuplicateGroup) {
    const checked = Array.from(checkedByGroup[group.name] ?? [])
    if (checked.length < 2) {
      setMessage('統合するには2件以上選択してください。')
      return
    }
    const keeperId = keeperByGroup[group.name] ?? checked[0]
    const loserIds = checked.filter((id) => id !== keeperId)
    startTransition(async () => {
      const result = await mergeArtists(keeperId, loserIds)
      if (result.success) {
        setMessage(`「${group.name}」を統合しました。`)
        removeGroup(group.name)
      } else {
        setMessage(`統合に失敗しました: ${result.message}`)
      }
    })
  }

  function handleConfirmSeparate(group: DuplicateGroup) {
    startTransition(async () => {
      const result = await markGroupAsConfirmedSeparate(
        group.name,
        group.candidates.map((c) => c.id)
      )
      if (result.success) {
        setMessage(`「${group.name}」を別人として確定しました。`)
        removeGroup(group.name)
      } else {
        setMessage(`確定に失敗しました: ${result.message}`)
      }
    })
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <h1 className="text-2xl font-bold">アーティスト重複レビュー</h1>
      <p className="mt-2 text-sm text-white/50">
        同名で複数登録されているが、Apple Music側のIDが異なるため自動統合できなかった組み合わせです。同一人物なら、統合先(★のもの。各候補の「これを統合先にする」で変更可)を決めたうえで、統合したい候補にチェックを入れて「選択した候補を統合」を押してください。統合先以外の候補のデータは統合先に移され、削除されます。別人なら「別人として確定」を押してください。
      </p>
      <p className="mt-1 text-xs text-white/30">残り{groups.length}グループ</p>

      {message && <p className="mt-4 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm">{message}</p>}

      {groups.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">レビュー待ちのグループはありません。</p>
      ) : (
        <ul className="mt-8 space-y-8">
          {groups.map((group) => {
            const checked = checkedByGroup[group.name] ?? new Set<string>()
            const keeperId = keeperByGroup[group.name] ?? group.candidates[0]?.id
            return (
              <li key={group.name} className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-bold">{group.name}</h2>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleMerge(group)}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
                    >
                      選択した候補を統合
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleConfirmSeparate(group)}
                      className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/5 disabled:opacity-40"
                    >
                      別人として確定
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.candidates.map((c) => {
                    const isChecked = checked.has(c.id)
                    return (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
                          isChecked ? 'border-white/40 bg-white/[0.06]' : 'border-white/10 hover:bg-white/[0.03]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheck(group.name, c.id)}
                          className="mt-1 shrink-0"
                        />
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-white/5">
                          {c.sampleAlbumJacketUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.sampleAlbumJacketUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[9px] text-white/20">
                              No Art
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/artists/${c.id}`}
                            target="_blank"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-white/40 underline hover:text-white/70"
                          >
                            ページを見る →
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-white/50">
                            {c.sampleAlbumTitle ?? '(アルバムなし)'}
                          </p>
                          <p className="mt-0.5 text-[11px] text-white/30">
                            アルバム{c.albumCount}・トラック{c.trackCount}
                          </p>
                          <p className="text-[11px] text-white/30">
                            Apple ID: {c.appleMusicArtistId ?? 'なし'}
                          </p>
                          <label
                            className={`mt-1 flex items-center gap-1 text-[11px] ${
                              keeperId === c.id ? 'font-medium text-amber-300' : 'text-white/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`keeper-${group.name}`}
                              checked={keeperId === c.id}
                              onChange={(e) => {
                                e.stopPropagation()
                                selectKeeper(group.name, c.id)
                              }}
                            />
                            {keeperId === c.id ? '★ 統合先(これが残る)' : 'これを統合先にする'}
                          </label>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
