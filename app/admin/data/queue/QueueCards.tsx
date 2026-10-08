'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { approveFeatured, approvePick, rejectFeatured, rejectPick, type QueueActionResult } from './actions'

export type QueueCard = {
  id: string
  context: string
  from: string
  to: string
  imageUrl?: string
  confidence: number | null
  reason?: string
  detailHref?: string
}

const ACTIONS: Record<'pick' | 'featured', { approve: (id: string) => Promise<QueueActionResult>; reject: (id: string) => Promise<QueueActionResult>; approveLabel: string; rejectLabel: string }> = {
  pick: { approve: approvePick, reject: rejectPick, approveLabel: '採用して本登録', rejectLabel: '却下(候補を外す)' },
  featured: { approve: approveFeatured, reject: rejectFeatured, approveLabel: '採用', rejectLabel: '却下' },
}

export default function QueueCards({
  source,
  cards,
  remaining,
}: {
  source: 'pick' | 'featured'
  cards: QueueCard[]
  remaining: number
}) {
  const router = useRouter()
  const [done, setDone] = useState<Map<string, 'ok' | 'ng'>>(new Map())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const actions = ACTIONS[source]

  function run(card: QueueCard, kind: 'ok' | 'ng') {
    if (busy || done.has(card.id)) return
    setBusy(card.id)
    startTransition(async () => {
      const result = await (kind === 'ok' ? actions.approve : actions.reject)(card.id)
      setBusy(null)
      if (result.success) {
        setDone((prev) => new Map(prev).set(card.id, kind))
        setErrors((prev) => {
          const next = new Map(prev)
          next.delete(card.id)
          return next
        })
        // 次の未処理カードへフォーカスを移す
        const next = cards.find((c) => c.id !== card.id && !done.has(c.id))
        if (next) document.getElementById(`card-${next.id}`)?.focus()
      } else {
        setErrors((prev) => new Map(prev).set(card.id, result.message))
      }
    })
  }

  const left = cards.filter((c) => !done.has(c.id)).length
  if (cards.length === 0) {
    return <p className="rounded-md border border-dashed border-white/15 p-6 text-sm text-white/50">確認待ちはありません。</p>
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-white/40">
        カードを選んで <kbd className="rounded border border-white/20 px-1">A</kbd> で採用、
        <kbd className="rounded border border-white/20 px-1">R</kbd> で却下。表示中 {left} / 全 {remaining.toLocaleString()}件
      </p>
      {cards.map((card) => {
        const state = done.get(card.id)
        const error = errors.get(card.id)
        const low = card.confidence !== null && card.confidence < 0.5
        return (
          <div
            key={card.id}
            id={`card-${card.id}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'a' || e.key === 'A') run(card, 'ok')
              if (e.key === 'r' || e.key === 'R') run(card, 'ng')
            }}
            className={`grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3.5 outline-none transition focus:border-amber-400/60 sm:grid-cols-[1fr_auto] ${state ? 'opacity-35' : ''}`}
          >
            <div className="flex min-w-0 gap-3">
              {card.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] text-white/35">{card.context}</p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="text-white/55">{card.from}</span>
                  <span className="text-white/25">→</span>
                  <span className="font-medium text-white">{card.to}</span>
                  {card.confidence !== null && (
                    <span
                      className={`rounded px-1.5 font-mono text-[11px] ${low ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}
                    >
                      確信度 {Math.round(card.confidence * 100)}%
                    </span>
                  )}
                </p>
                {card.reason && <p className="mt-1.5 border-l-2 border-amber-400/50 pl-2 text-xs text-white/50">{card.reason}</p>}
                {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-start justify-end gap-1.5">
              {state ? (
                <span className="text-xs text-white/50">{state === 'ok' ? '採用しました' : '却下しました'}</span>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run(card, 'ok')}
                    className="rounded-md border border-emerald-400/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40"
                  >
                    {busy === card.id && isPending ? '処理中…' : actions.approveLabel}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => run(card, 'ng')}
                    className="rounded-md border border-red-400/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-40"
                  >
                    {actions.rejectLabel}
                  </button>
                  {card.detailHref && (
                    <Link href={card.detailHref} className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/60 hover:bg-white/5">
                      詳しく見る
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
      {left === 0 && remaining > cards.length && (
        <button
          type="button"
          onClick={() => router.refresh()}
          className="w-full rounded-md border border-white/15 py-2 text-sm hover:bg-white/5"
        >
          次の{Math.min(30, remaining - cards.length)}件を読み込む
        </button>
      )}
    </div>
  )
}
