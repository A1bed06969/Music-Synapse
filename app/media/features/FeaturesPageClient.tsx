'use client'

import { useState, useTransition } from 'react'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import BackLink from '@/app/components/navigation/BackLink'
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

  const titleBlock = (
    <div className="mt-4">
      <h1 className="text-2xl font-bold">キュレーションコンテンツ</h1>
      <p className="mt-2 text-sm text-white/50">音楽誌・メディア独自の企画コンテンツをアーカイブしています。</p>
    </div>
  )

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
              className={`flex min-w-0 gap-3 rounded-lg border p-3 text-left transition hover:bg-white/[0.06] ${
                isActive ? 'border-white/30 bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'
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
    <DetailPageShell
      topBar={<BackLink fallbackHref="/media" fallbackLabel="メディア&パワープレイに戻る" />}
      left={
        <>
          {titleBlock}
          <div className="mt-8">{headerBlock}</div>
        </>
      }
      center={entriesBlock}
      right={selectorBlock}
      mobileContent={
        <>
          {titleBlock}
          <div className="mt-6">{selectorBlock}</div>
          <div className="mt-8">{headerBlock}</div>
          <div className="mt-8">{entriesBlock}</div>
        </>
      }
    />
  )
}
