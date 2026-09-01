'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { usePreviewPlayer } from '@/app/components/PreviewPlayerContext'
import PreviewButton from '@/app/components/PreviewButton'
import { useSwipeGesture, type SwipeDirection, type DragState } from './useSwipeGesture'
import { useDiggingSound } from './useDiggingSound'
import RecordSleeve from './RecordSleeve'
import GenreShelfTabs from './GenreShelfTabs'
import ShelfPicker from './ShelfPicker'
import RecordDetailPanel from './RecordDetailPanel'
import CrateFrame from './CrateFrame'
import type { HandGesture } from './RecordDiggingHand'
import { NEW_ARRIVALS_KEY, type DiggingShelf, type DiggingRecord } from '@/utils/recordDigging'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// 送る(下スワイプ)/つまみ上げる(上スワイプ)モーションの再生時間。
// globals.cssのanimate-record-send-away/animate-hand-send、
// animate-record-lift/animate-hand-pickの尺と揃えてある。
const SEND_ANIMATION_MS = 340
const PICK_ANIMATION_MS = 380

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

/** ジャケットスタックの「奥から浮かび上がる」導入アニメーションを、このDOM
 * ノードが実際にマウントされた瞬間だけ判定して固定する。useState の遅延
 *初期化子は、このコンポーネントインスタンスがマウントされた最初の1回しか
 * 評価されないため、以降ドラッグや棚切り替えで親が何度再レンダーされても
 * (このノード自体が再マウントされない限り)結果がぶれない。もしuseEffect +
 * 親のstateで毎レンダー判定すると、アニメーション再生中の再レンダー(例えば
 * ドラッグ)でクラスが外れてアニメーションが途中で切れてしまう。 */
function JacketStackEntrance({ children, skip }: { children: ReactNode; skip: boolean }) {
  const [playEntrance] = useState(() => !skip)
  return <div className={`w-full ${playEntrance ? 'animate-junkie-dig-stack-in' : ''}`}>{children}</div>
}

export default function RecordDiggingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { play: playPreview, stop: stopPreview } = usePreviewPlayer()
  const { playFlip, playPickup } = useDiggingSound()

  const [shelves, setShelves] = useState<DiggingShelf[]>([])
  const [shelfIndex, setShelfIndex] = useState(0)
  const [deck, setDeck] = useState<DiggingRecord[]>([])
  const [deckPosition, setDeckPosition] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [showHint, setShowHint] = useState(true)

  // 送る/つまみ上げるモーション用の状態。exitingは下スワイプで弾かれた直後の
  // 1枚(送られて消えるアニメーションの間だけ描画を残す)、gesture/pulseKeyは
  // 手のイラストのモーション制御(pulseKeyは連続で下スワイプされた時にも
  // 毎回アニメーションを頭から再生させるための強制remountキー)。
  const [exiting, setExiting] = useState<DiggingRecord | null>(null)
  const [gesture, setGesture] = useState<HandGesture>('idle')
  const [pulseKey, setPulseKey] = useState(0)
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendGestureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // しきい値に達する前のドラッグ量。手前のジャケットをリアルタイムに指へ
  // 追従させ、離した時にしきい値未満ならスプリングバックさせる。
  const [dragState, setDragState] = useState<DragState>({ dx: 0, dy: 0, dragging: false })

  // ジャケットの「奥から浮かび上がる」導入アニメーションは、モーダルを開いた
  // 直後の初回表示だけに出す(棚を切り替えるたびに再生すると煩わしいため)。
  // 初回readyに到達した後はtrueに固定し、以降のready再到達(棚切り替え)では
  // アニメーションクラスを付けない。
  const [hasEntered, setHasEntered] = useState(false)
  useEffect(() => {
    if (state === 'ready' && !hasEntered) setHasEntered(true)
  }, [state, hasEntered])

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
    if (current.firstTrackId && current.firstTrackPreviewUrl) {
      playPreview(current.firstTrackId, current.firstTrackPreviewUrl)
    } else {
      stopPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, deckPosition, state])

  // モーダルを閉じたら再生停止
  useEffect(() => {
    return () => stopPreview()
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
    // つまみ上げモーション中(モーダルが閉じて遷移するまでの間)は入力を無視する
    if (gesture === 'picking') return

    if (direction === 'down') {
      playFlip()

      const outgoing = deck[deckPosition]
      setExiting(outgoing)
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current)
      exitTimeoutRef.current = setTimeout(() => setExiting(null), SEND_ANIMATION_MS)

      setPulseKey((k) => k + 1)
      setGesture('sending')
      if (sendGestureTimeoutRef.current) clearTimeout(sendGestureTimeoutRef.current)
      sendGestureTimeoutRef.current = setTimeout(() => setGesture('idle'), SEND_ANIMATION_MS)

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
      setGesture('picking')
      if (pickTimeoutRef.current) clearTimeout(pickTimeoutRef.current)
      // つまみ上げアニメーションを見せてからモーダルを閉じて遷移する
      pickTimeoutRef.current = setTimeout(() => {
        stopPreview()
        onClose()
        router.push(`/albums/${current.id}`)
      }, PICK_ANIMATION_MS)
      return
    }

    if (shelves.length <= 1) return

    if (direction === 'left') goToRelativeShelf(-1)
    else if (direction === 'right') goToRelativeShelf(1)
  }

  /** 左右スワイプ・PREV/NEXTボタン共通の、隣の棚への移動。 */
  function goToRelativeShelf(step: -1 | 1) {
    if (shelves.length <= 1 || gesture === 'picking') return
    playFlip()
    setShelfIndex((i) => (i + step + shelves.length) % shelves.length)
  }

  /** 棚選択レール(ShelfPicker)からのタップによるジャンプ。左右スワイプの
   * 1つずつの移動とは違い、一覧から直接その棚へ飛ぶ。 */
  function handleSelectShelf(index: number) {
    if (index === shelfIndex || gesture === 'picking') return
    playFlip()
    setShelfIndex(index)
  }

  // アンマウント時に保留中のモーション用タイマーを片付ける
  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current)
      if (sendGestureTimeoutRef.current) clearTimeout(sendGestureTimeoutRef.current)
      if (pickTimeoutRef.current) clearTimeout(pickTimeoutRef.current)
    }
  }, [])

  function handleClose() {
    // つまみ上げモーション中に閉じられた場合、保留中の遷移をキャンセルする
    if (pickTimeoutRef.current) clearTimeout(pickTimeoutRef.current)
    stopPreview()
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

  const swipeRef = useSwipeGesture(handleSwipe, setDragState)

  const current = deck[deckPosition]
  const upNext = deck.slice(deckPosition + 1, deckPosition + 4)

  const currentShelf = shelves[shelfIndex]

  return (
    <div
      className="animate-junkie-dig-scrim-in fixed inset-0 z-50 flex flex-col bg-[#0e0a06]"
      role="dialog"
      aria-modal="true"
      aria-label="Junkie Dig"
    >
      {/* 背景: CrateFrame(クレートの実写、ピント合った状態)と同じ元写真を、
       * 強くぼかし・暗くした状態で全面に敷く。CrateFrame自体をもう一枚重ねると
       * 二重の箱に見えてしまうため、あくまで「奥の部屋がボケて写り込んでいる」
       * 被写界深度的な処理にとどめている。scale-110は、ぼかしで画像端の透明
       * フチが見えてしまうのを画面外へ逃がすため。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/record-digging/record-box.jpg"
          alt=""
          className="h-full w-full scale-110 object-cover blur-2xl"
          draggable={false}
        />
        <div className="absolute inset-0 bg-[#0e0a06]/55" />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 22%, rgba(240,151,90,0.16), transparent 62%)' }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 min(22vw,220px) rgba(0,0,0,0.75)' }}
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

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden lg:flex-row lg:items-center lg:gap-8 lg:px-10">
        <div
          ref={swipeRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden overscroll-contain px-6 lg:px-0"
        >
          {state === 'error' && (
            <p className="text-sm text-white/50">読み込みに失敗しました。閉じてもう一度開いてみてください。</p>
          )}
          {state === 'loading' && <p className="text-sm text-white/30">棚を探しています...</p>}
          {state === 'ready' && current && (
            <>
              {shelves.length > 1 && (
                <div className="pointer-events-none absolute inset-y-0 left-1 z-30 flex items-center sm:left-4">
                  <div className="pointer-events-auto flex flex-col items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      className="rounded-full border-amber-400/30 bg-black/30 backdrop-blur hover:bg-black/50"
                      onClick={() => goToRelativeShelf(-1)}
                      aria-label="前の棚へ"
                    >
                      <ChevronLeft className="text-amber-200" />
                    </Button>
                    <span className="hidden text-[9px] tracking-wide text-white/30 sm:block">PREV SHELF</span>
                  </div>
                </div>
              )}

              <JacketStackEntrance skip={hasEntered}>
                <CrateFrame>
                  <RecordSleeve
                    current={current}
                    upNext={upNext}
                    exiting={exiting}
                    gesture={gesture}
                    pulseKey={pulseKey}
                    dragState={dragState}
                  />
                </CrateFrame>
                <div className="mt-8 flex flex-col items-center gap-3 text-center lg:hidden">
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
              </JacketStackEntrance>

              {shelves.length > 1 && (
                <div className="pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center sm:right-4">
                  <div className="pointer-events-auto flex flex-col items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      className="rounded-full border-amber-400/30 bg-black/30 backdrop-blur hover:bg-black/50"
                      onClick={() => goToRelativeShelf(1)}
                      aria-label="次の棚へ"
                    >
                      <ChevronRight className="text-amber-200" />
                    </Button>
                    <span className="hidden text-[9px] tracking-wide text-white/30 sm:block">NEXT SHELF</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {state === 'ready' && current && (
          <div className="hidden w-80 shrink-0 lg:block">
            <div className="mb-4 flex justify-center">
              {current.firstTrackId && (
                <PreviewButton
                  key={current.firstTrackId}
                  previewUrl={current.firstTrackPreviewUrl}
                  trackId={current.firstTrackId}
                  size="lg"
                />
              )}
            </div>
            <RecordDetailPanel current={current} shelf={currentShelf} />
          </div>
        )}
      </div>

      {shelves.length > 0 && <ShelfPicker shelves={shelves} currentIndex={shelfIndex} onSelect={handleSelectShelf} />}

      {showHint && state === 'ready' && (
        <div className="pointer-events-none relative z-10 flex justify-center gap-6 pb-2 text-[11px] text-white/40">
          <span>↓ 次へ</span>
          <span>↑ 詳細へ</span>
          {shelves.length > 1 && <span>← → 棚を変える</span>}
        </div>
      )}
    </div>
  )
}
