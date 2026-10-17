'use client'

import { useState, useTransition } from 'react'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import SectionHeading from '@/app/components/detail/SectionHeading'
import { hubContent } from '@/app/components/hub/hubContents'
import RankingPreviewPanel from './RankingPreviewPanel'
import RankingPreviewHeader from './RankingPreviewHeader'
import { getRankingPreview, type RankingPreview } from './actions'

export type RankingCard = {
  id: string
  name: string
  mediaName: string | null
  description: string | null
  imageUrl: string | null
  listType: string
}

/** キュレーションコンテンツページの3カラムシェル。右カラムのカード一覧で
 * クリックされた企画を、ページ遷移せず中央カラムにその場でプレビュー表示する
 * (2026-09-24、企画選択=右・アーティスト一覧=中央に変更)。
 * 初期表示は最新の企画(cards[0])のプレビューをサーバーから渡し、空状態を
 * 避ける。 */
export default function FeaturesPageClient({
  cards,
  initialPreview,
}: {
  cards: RankingCard[]
  initialPreview: RankingPreview | null
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialPreview?.id ?? null)
  const [preview, setPreview] = useState<RankingPreview | null>(initialPreview)
  const [isPending, startTransition] = useTransition()

  function handleSelect(id: string) {
    setSelectedId(id)
    startTransition(async () => {
      const result = await getRankingPreview(id)
      setPreview(result)
    })
  }

  const c = hubContent('curation')
  const stats = [{ label: '企画', value: cards.length }]

  const selectorBlock =
    cards.length === 0 ? (
      <p className="text-sm text-white/40">まだ企画コンテンツが登録されていません。</p>
    ) : (
      <div className="flex flex-col gap-3">
        {cards.map((card) => {
          const isActive = card.id === selectedId
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleSelect(card.id)}
              style={isActive ? { borderColor: c.color, backgroundColor: `${c.color}1f` } : undefined}
              className={`flex min-w-0 gap-3 rounded-lg border p-3 text-left transition hover:bg-white/[0.06] ${
                isActive ? 'bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white/5">
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl text-white/20">🎵</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-white/40">{card.mediaName ?? 'メディア企画'}</p>
                  <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                    {card.listType === 'selection' ? '選出' : 'ランキング'}
                  </span>
                </div>
                <p className="mt-1 truncate font-semibold">{card.name}</p>
                {card.description && <p className="mt-1 truncate text-xs text-white/50">{card.description}</p>}
              </div>
            </button>
          )
        })}
      </div>
    )

  const headerBlock =
    isPending || !preview ? (
      <div className="animate-pulse">
        <div className="aspect-[21/9] w-full rounded-lg bg-white/5" />
        <div className="mt-4 h-4 w-2/3 rounded bg-white/5" />
        <div className="mt-2 h-3 w-1/3 rounded bg-white/5" />
      </div>
    ) : (
      <RankingPreviewHeader preview={preview} />
    )

  const entriesBlock =
    isPending || !preview ? (
      <div className="grid animate-pulse grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-md bg-white/5" />
        ))}
      </div>
    ) : (
      <RankingPreviewPanel preview={preview} />
    )

  return (
    <HubShell
      hubKey="curation"
      stats={stats}
      leftExtra={headerBlock}
      rightExtra={
        <div>
          <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40">FEATURES</p>
          {selectorBlock}
        </div>
      }
      mobileContent={
        <>
          <HubIdentity hubKey="curation" stats={stats} />
          <div className="mt-2">{headerBlock}</div>
          <div className="mt-8">{selectorBlock}</div>
          <div className="mt-8">{entriesBlock}</div>
        </>
      }
    >
      <SectionHeading number={c.number} label="PICKED ARTISTS & WORKS" color={c.color} />
      {entriesBlock}
    </HubShell>
  )
}
