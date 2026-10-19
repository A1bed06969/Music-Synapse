'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { artworkAt } from '@/utils/artworkSize'
import type { Board, BoardCard } from '@/utils/gameData'
import { completeGame, newBoard, type GameResult } from '../../actions'

const ACCENT = '#3fd0e0'
const MAX_MISSES = 3
const MISMATCH_DELAY_MS = 1000

type Status = 'playing' | 'cleared' | 'failed'

export default function PlayClient({ themeId, themeTitle, initialBoard }: { themeId: string; themeTitle: string; initialBoard: Board }) {
  const [board, setBoard] = useState(initialBoard)
  const [flipped, setFlipped] = useState<BoardCard[]>([])
  const [matched, setMatched] = useState<string[]>([])
  const [misses, setMisses] = useState(0)
  const [moves, setMoves] = useState(0)
  const [combo, setCombo] = useState(0)
  const [status, setStatus] = useState<Status>('playing')
  const [result, setResult] = useState<GameResult | null>(null)
  const [muted, setMuted] = useState(false)
  const [loading, setLoading] = useState(false)
  const lockedRef = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const pairById = new Map(board.pairs.map((p) => [p.albumId, p]))

  function stopAudio() {
    audioRef.current?.pause()
  }

  // 1枚目をめくったアルバムの試聴を流す。タップ操作の中で呼ぶので、スマホでも再生できる
  function playPreview(albumId: string) {
    if (muted) return
    const url = pairById.get(albumId)?.previewUrl
    if (!url) return
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    audio.pause()
    audio.src = url
    audio.currentTime = 0
    audio.volume = 0.8
    audio.play().catch(() => {})
  }

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  async function finish(nextStatus: Status, matchedIds: string[], finalMisses: number, finalMoves: number) {
    setStatus(nextStatus)
    try {
      const r = await completeGame({
        themeId,
        albumIds: matchedIds,
        cleared: nextStatus === 'cleared',
        misses: finalMisses,
        moves: finalMoves,
      })
      setResult(r)
    } catch {
      setResult({ stars: 0, newCount: 0, collected: 0, total: 0, rare: null })
    }
  }

  function flip(card: BoardCard) {
    if (status !== 'playing' || lockedRef.current) return
    if (matched.includes(card.albumId)) return
    if (flipped.some((f) => f.key === card.key)) return

    if (flipped.length === 0) {
      setFlipped([card])
      playPreview(card.albumId)
      return
    }

    const first = flipped[0]
    const nextMoves = moves + 1
    setMoves(nextMoves)
    setFlipped([first, card])

    if (first.albumId === card.albumId) {
      const nextMatched = [...matched, card.albumId]
      setMatched(nextMatched)
      setCombo((c) => c + 1)
      setFlipped([])
      if (nextMatched.length === board.pairs.length) {
        window.setTimeout(stopAudio, 2500)
        void finish('cleared', nextMatched, misses, nextMoves)
      }
      return
    }

    lockedRef.current = true
    const nextMisses = misses + 1
    setMisses(nextMisses)
    setCombo(0)
    window.setTimeout(() => {
      setFlipped([])
      stopAudio()
      lockedRef.current = false
      if (nextMisses >= MAX_MISSES) void finish('failed', matched, nextMisses, nextMoves)
    }, MISMATCH_DELAY_MS)
  }

  async function replay() {
    setLoading(true)
    stopAudio()
    const next = await newBoard(themeId)
    if (next) {
      setBoard(next)
      setFlipped([])
      setMatched([])
      setMisses(0)
      setMoves(0)
      setCombo(0)
      setResult(null)
      setStatus('playing')
      lockedRef.current = false
    }
    setLoading(false)
  }

  const isUp = (card: BoardCard) => matched.includes(card.albumId) || flipped.some((f) => f.key === card.key)

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/game" className="text-xs text-white/40 hover:text-white/70">
          ← テーマ選択
        </Link>
        <button
          type="button"
          onClick={() => {
            setMuted((m) => !m)
            if (!muted) stopAudio()
          }}
          className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/5"
          aria-pressed={muted}
        >
          {muted ? '🔇 試聴オフ' : '🔊 試聴オン'}
        </button>
      </div>
      <h1 className="mt-3 text-lg font-black leading-tight">{themeTitle}</h1>

      <div className="mt-3 flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1" aria-label={`ミス ${misses}/${MAX_MISSES}`}>
          {Array.from({ length: MAX_MISSES }).map((_, i) => (
            <span key={i} className="text-lg" style={{ color: i < MAX_MISSES - misses ? ACCENT : 'rgba(255,255,255,0.15)' }}>
              ♥
            </span>
          ))}
        </span>
        <span className="text-white/60">
          手数 <span className="font-bold tabular-nums text-white">{moves}</span>
        </span>
        <span className="text-white/60">
          ペア <span className="font-bold tabular-nums text-white">{matched.length}</span>/{board.pairs.length}
        </span>
        {combo >= 2 && (
          <span className="rounded-full px-2 py-0.5 text-xs font-black text-black" style={{ backgroundColor: ACCENT }}>
            {combo} COMBO
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {board.cards.map((card) => {
          const pair = pairById.get(card.albumId)!
          const up = isUp(card)
          const done = matched.includes(card.albumId)
          return (
            <button
              key={card.key}
              type="button"
              data-album-id={card.albumId}
              onClick={() => flip(card)}
              disabled={status !== 'playing'}
              aria-label={up ? (card.kind === 'jacket' ? pair.albumTitle : pair.artistName) : '裏向きのカード'}
              className="relative aspect-square w-full [perspective:800px]"
            >
              <span
                className="absolute inset-0 transition-transform duration-300 [transform-style:preserve-3d]"
                style={{ transform: up ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
              >
                {/* 裏面(伏せた状態) */}
                <span
                  className="absolute inset-0 flex items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] [backface-visibility:hidden]"
                >
                  <span className="text-2xl font-black" style={{ color: `${ACCENT}99` }}>
                    ♪
                  </span>
                </span>
                {/* 表面 */}
                <span
                  className="absolute inset-0 overflow-hidden rounded-lg [backface-visibility:hidden]"
                  style={{
                    transform: 'rotateY(180deg)',
                    boxShadow: done ? `0 0 0 2px ${ACCENT}` : undefined,
                  }}
                >
                  {card.kind === 'jacket' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={artworkAt(pair.jacketUrl, 300) ?? pair.jacketUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1b2a33] to-[#10161b] p-2 text-center">
                      <span className="line-clamp-4 text-sm font-black leading-snug text-white">{pair.artistName}</span>
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {status === 'playing' && (
        <p className="mt-4 text-center text-xs text-white/40">ジャケットと、そのアーティスト名のペアを探そう</p>
      )}

      {status !== 'playing' && (
        <section className="mt-6 rounded-xl border p-4" style={{ borderColor: `${ACCENT}66`, backgroundColor: `${ACCENT}10` }}>
          <p className="text-[11px] font-bold tracking-[0.14em]" style={{ color: ACCENT }}>
            {status === 'cleared' ? 'CLEAR' : 'GAME OVER'}
          </p>
          {status === 'cleared' && (
            <p className="mt-1 text-2xl" aria-label={`星 ${result?.stars ?? 0}`}>
              {[1, 2, 3].map((n) => (
                <span key={n} style={{ color: n <= (result?.stars ?? 0) ? '#ffd23f' : 'rgba(255,255,255,0.15)' }}>
                  ★
                </span>
              ))}
            </p>
          )}
          {!result && <p className="mt-2 text-sm text-white/50">図鑑に保存しています…</p>}
          {result && (
            <>
              <p className="mt-2 text-sm">
                {result.newCount > 0 ? (
                  <>
                    <span className="font-black" style={{ color: ACCENT }}>
                      {result.newCount}枚
                    </span>
                    が新しく図鑑に入りました
                  </>
                ) : (
                  '今回は新しく入ったジャケットはありません'
                )}
                {result.total > 0 && (
                  <span className="ml-2 text-xs text-white/50">
                    このテーマ {result.collected}/{result.total}
                  </span>
                )}
              </p>
              {result.rare && (
                <Link
                  href={`/albums/${result.rare.albumId}`}
                  className="mt-3 flex items-center gap-3 rounded-lg border border-[#ffd23f]/50 bg-[#ffd23f]/10 p-2 hover:bg-[#ffd23f]/15"
                >
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={artworkAt(result.rare.jacketUrl, 200) ?? result.rare.jacketUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-black tracking-[0.14em] text-[#ffd23f]">RARE ・ ミスなしクリア報酬</span>
                    <span className="block truncate text-sm font-bold">{result.rare.title}</span>
                    <span className="block truncate text-xs text-white/60">{result.rare.artistName}</span>
                  </span>
                </Link>
              )}
            </>
          )}

          {matched.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-2">
              {matched.map((id) => {
                const p = pairById.get(id)!
                return (
                  <li key={id}>
                    <Link href={`/albums/${id}`} className="block hover:opacity-80">
                      <span className="block aspect-square overflow-hidden rounded-md bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={artworkAt(p.jacketUrl, 200) ?? p.jacketUrl} alt={p.albumTitle} className="h-full w-full object-cover" />
                      </span>
                      <span className="mt-1 block truncate text-[11px] font-bold">{p.albumTitle}</span>
                      <span className="block truncate text-[10px] text-white/50">{p.artistName}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={replay}
              disabled={loading}
              className="rounded-md px-4 py-2.5 text-sm font-black text-black disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {loading ? '準備中…' : 'もう一度'}
            </button>
            <Link href="/game" className="rounded-md border border-white/20 px-4 py-2.5 text-sm font-bold hover:bg-white/5">
              テーマ選択
            </Link>
            <Link href={`/game/collection/${themeId}`} className="rounded-md border border-white/20 px-4 py-2.5 text-sm font-bold hover:bg-white/5">
              図鑑を見る
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
