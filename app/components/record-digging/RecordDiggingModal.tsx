'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePreviewPlayer } from '@/app/components/PreviewPlayerContext'
import PreviewButton from '@/app/components/PreviewButton'
import { useSwipeGesture, type SwipeDirection } from './useSwipeGesture'
import { useDiggingSound } from './useDiggingSound'
import RecordSleeve from './RecordSleeve'
import GenreShelfTabs from './GenreShelfTabs'
import { NEW_ARRIVALS_KEY, type DiggingShelf, type DiggingRecord } from '@/utils/recordDigging'

function shuffle<T>(items: T[]): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** 山札を再シャッフルする際、直前の1枚(prevLastId)が新しい山札の先頭に来ないよう
 * 1回だけ入れ替える(セッション内で同じ盤がすぐ連続するのを防ぐ)。 */
function reshuffleDeck(items: DiggingRecord[], prevLastId: string | null): DiggingRecord[] {
  const shuffled = shuffle(items)
  if (shuffled.length > 1 && prevLastId && shuffled[0].id === prevLastId) {
    ;[shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]]
  }
  return shuffled
}

type LoadState = 'loading' | 'ready' | 'error'

export default function RecordDiggingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { setPlayingTrackId } = usePreviewPlayer()
  const { playFlip, playPickup } = useDiggingSound()

  const [shelves, setShelves] = useState<DiggingShelf[]>([])
  const [shelfIndex, setShelfIndex] = useState(0)
  const [deck, setDeck] = useState<DiggingRecord[]>([])
  const [deckPosition, setDeckPosition] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [showHint, setShowHint] = useState(true)

  // 棚一覧の取得(モーダルを開いた瞬間に1回だけ)
  useEffect(() => {
    let cancelled = false
    fetch('/api/record-digging/shelves')
      .then((res) => {
        if (!res.ok) throw new Error('shelves fetch failed')
        return res.json()
      })
      .then((data: DiggingShelf[]) => {
        if (!cancelled) setShelves(data)
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 現在の棚のレコード取得(shelvesが決まった時・shelfIndexが変わった時)
  useEffect(() => {
    if (shelves.length === 0) return
    const shelf = shelves[shelfIndex]
    let cancelled = false
    setState('loading')
    fetch(`/api/record-digging/records?shelf=${encodeURIComponent(shelf.key)}`)
      .then((res) => {
        if (!res.ok) throw new Error('records fetch failed')
        return res.json()
      })
      .then((data: DiggingRecord[]) => {
        if (cancelled) return
        if (data.length === 0) {
          // 「新着」が0件なら、棚一覧から除外して次のジャンル棚へ
          if (shelf.key === NEW_ARRIVALS_KEY && shelves.length > 1) {
            setShelves((prev) => prev.filter((s) => s.key !== NEW_ARRIVALS_KEY))
            setShelfIndex(0)
            return
          }
          setState('error')
          return
        }
        setDeck(shuffle(data))
        setDeckPosition(0)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelves, shelfIndex])

  // 現在のレコードが変わるたびに1曲目を自動再生(試聴できなければ止めるだけ)
  useEffect(() => {
    if (state !== 'ready' || deck.length === 0) return
    const current = deck[deckPosition]
    setPlayingTrackId(current.firstTrackPreviewUrl && current.firstTrackId ? current.firstTrackId : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, deckPosition, state])

  // モーダルを閉じたら再生停止
  useEffect(() => {
    return () => setPlayingTrackId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 4000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  function handleSwipe(direction: SwipeDirection) {
    setShowHint(false)
    if (state !== 'ready' || deck.length === 0) return

    if (direction === 'down') {
      playFlip()
      const next = deckPosition + 1
      if (next < deck.length) {
        setDeckPosition(next)
      } else {
        setDeck(reshuffleDeck(deck, deck[deck.length - 1]?.id ?? null))
        setDeckPosition(0)
      }
      return
    }

    if (direction === 'up') {
      const current = deck[deckPosition]
      playPickup()
      setPlayingTrackId(null)
      onClose()
      router.push(`/albums/${current.id}`)
      return
    }

    if (shelves.length <= 1) return

    playFlip()
    if (direction === 'left') {
      setShelfIndex((i) => (i - 1 + shelves.length) % shelves.length)
    } else if (direction === 'right') {
      setShelfIndex((i) => (i + 1) % shelves.length)
    }
  }

  function handleClose() {
    setPlayingTrackId(null)
    onClose()
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const swipeRef = useSwipeGesture(handleSwipe)

  const current = deck[deckPosition]
  const upNext = deck.slice(deckPosition + 1, deckPosition + 3)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#120d08]" role="dialog" aria-modal="true" aria-label="Junkie Dig">
      {/* オリジナル背景: 暖色照明+木目テクスチャ(SVG feTurbulence)。画像アセット無し */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-20" aria-hidden>
        <filter id="junkie-dig-wood-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.15" numOctaves={3} seed={7} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#junkie-dig-wood-grain)" />
      </svg>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 20%, rgba(240,151,90,0.18), transparent 60%)' }}
      />

      <div className="relative z-10 flex items-center justify-between p-4">
        <span className="text-sm font-semibold tracking-wide text-amber-200">Junkie Dig</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label="閉じる"
          className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          閉じる ✕
        </button>
      </div>

      {shelves.length > 0 && <GenreShelfTabs shelves={shelves} currentIndex={shelfIndex} />}

      <div ref={swipeRef} className="relative z-10 flex flex-1 items-center justify-center overflow-hidden overscroll-contain px-6">
        {state === 'error' && (
          <p className="text-sm text-white/50">読み込みに失敗しました。閉じてもう一度開いてみてください。</p>
        )}
        {state === 'loading' && <p className="text-sm text-white/30">棚を探しています...</p>}
        {state === 'ready' && current && (
          <div className="w-full">
            <RecordSleeve current={current} upNext={upNext} />
            <div className="mt-6 flex flex-col items-center gap-3 text-center">
              <p className="text-lg font-bold text-white">{current.title}</p>
              <p className="text-sm text-white/50">{current.artistName}</p>
              {current.firstTrackId && (
                <PreviewButton
                  key={current.firstTrackId}
                  previewUrl={current.firstTrackPreviewUrl}
                  trackId={current.firstTrackId}
                  size="lg"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {showHint && state === 'ready' && (
        <div className="pointer-events-none relative z-10 flex justify-center gap-6 pb-6 text-[11px] text-white/40">
          <span>↓ 次へ</span>
          <span>↑ 詳細へ</span>
          {shelves.length > 1 && <span>← → 棚を変える</span>}
        </div>
      )}
    </div>
  )
}
