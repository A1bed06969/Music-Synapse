'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
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

  // アーティストなどのリンクを開く直前に、選んでいた企画とスクロール位置を覚えておく。
  // 「戻る」でこのページに戻ってきたときに、同じ企画の一覧と位置に戻す
  // (履歴のURLには頼らない: 戻ると、ページがサーバーで先頭の企画から作り直されるため)。
  // スクロールするのは、スマホはページ全体、PCは中央・右などのカラム。
  const RETURN_KEY = 'features-return'
  const RETURN_TTL_MS = 30 * 60_000
  const pendingScrollRef = useRef<{ id: string; scroll: number[] } | null>(null)
  const containers = (): (HTMLElement | Window)[] => [window, ...Array.from(document.querySelectorAll<HTMLElement>('div[class*="overflow-y-auto"]'))]

  useEffect(() => {
    function remember(e: MouseEvent) {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !selectedId) return
      const href = a.getAttribute('href') ?? ''
      if (!href.startsWith('/') || href.startsWith('/media/features')) return
      try {
        sessionStorage.setItem(
          RETURN_KEY,
          JSON.stringify({ id: selectedId, ts: Date.now(), scroll: containers().map((c) => (c instanceof Window ? c.scrollY : c.scrollTop)) })
        )
      } catch {}
    }
    document.addEventListener('click', remember, true)
    return () => document.removeEventListener('click', remember, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // 開いた直後に、覚えていた企画があれば切り替える(開いたら消す。最初の1回だけ)
  const restoredOnceRef = useRef(false)
  useEffect(() => {
    if (restoredOnceRef.current) return
    restoredOnceRef.current = true
    let saved: { id: string; ts: number; scroll: number[] } | null = null
    try {
      saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null')
      sessionStorage.removeItem(RETURN_KEY)
    } catch {}
    if (!saved || Date.now() - saved.ts > RETURN_TTL_MS || !cards.some((c) => c.id === saved!.id)) return
    pendingScrollRef.current = { id: saved.id, scroll: saved.scroll }
    if (saved.id !== selectedId) handleSelect(saved.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 企画の中身が表示できたら、覚えていたスクロール位置へ戻す(画像などで高さが決まるまで数回試す)
  useEffect(() => {
    const pending = pendingScrollRef.current
    // 戻る前に見ていた企画の中身が表示できてから戻す(切り替え中の古い中身には適用しない)
    if (!pending || isPending || preview?.id !== pending.id) return
    const target = pending.scroll
    pendingScrollRef.current = null
    if (!target.some((n) => n > 0)) return
    let tries = 0
    const timer = window.setInterval(() => {
      const cs = containers()
      target.forEach((y, i) => {
        const c = cs[i]
        if (!c || y <= 0) return
        if (c instanceof Window) c.scrollTo(0, y)
        else c.scrollTop = y
      })
      if (++tries >= 8) window.clearInterval(timer)
    }, 150)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, isPending])

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
          {/* 下へスクロールしても、どの企画の一覧を見ているか分かるように、企画名を上に追従させる
              (サイトのヘッダー(高さ57px)のすぐ下に貼り付く) */}
          {preview && (
            <div className="sticky top-[57px] z-10 -mx-6 mt-8 border-y border-white/10 bg-[#0a0a0a]/95 px-6 py-2 backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
                  {cards.find((card) => card.id === preview.id)?.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cards.find((card) => card.id === preview.id)!.imageUrl!} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] tracking-[0.14em]" style={{ color: c.color }}>
                    {preview.mediaName ?? 'メディア企画'}
                  </span>
                  <span className="block truncate text-sm font-bold">{preview.name}</span>
                </span>
                <span className="shrink-0 text-[11px] text-white/40">全{preview.totalCount}件</span>
              </div>
            </div>
          )}
          <div className="mt-4">{entriesBlock}</div>
        </>
      }
    >
      <SectionHeading number={c.number} label="PICKED ARTISTS & WORKS" color={c.color} />
      {entriesBlock}
    </HubShell>
  )
}
