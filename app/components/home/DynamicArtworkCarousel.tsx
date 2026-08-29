'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/** バナー右側専用のページ送りカルーセル。左側(BannerShell)には触れず、
 * 右側のみをページ単位で差し替える。クリックのドットとスワイプの両方に対応。
 * ページの中身はサーバー側で事前に組み立て済みのReactNodeとして受け取る
 * (Server ComponentからClient Componentへ関数propsは渡せないため、
 * renderPageコールバックではなく完成済みのJSX配列を渡す設計にしている)。 */
export default function DynamicArtworkCarousel({
  pages,
  emptyMessage,
}: {
  pages: ReactNode[]
  emptyMessage: string
}) {
  const totalPages = pages.length
  const [page, setPage] = useState(0)
  const [visible, setVisible] = useState(true)
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    setVisible(false)
    const t = setTimeout(() => setVisible(true), 20)
    return () => clearTimeout(t)
  }, [page])

  if (totalPages === 0) {
    return <p className="text-sm text-white/30">{emptyMessage}</p>
  }

  function goTo(next: number) {
    setPage(((next % totalPages) + totalPages) % totalPages)
  }

  return (
    <div
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null) return
        const delta = e.changedTouches[0].clientX - touchStartX.current
        if (Math.abs(delta) > 40) goTo(page + (delta < 0 ? 1 : -1))
        touchStartX.current = null
      }}
    >
      <div
        className="transition-all duration-300 ease-out"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(8px)' }}
      >
        {pages[page]}
      </div>

      {totalPages > 1 && (
        <div className="mt-5 flex justify-end gap-1.5">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i + 1}ページ目を表示`}
              onClick={() => goTo(i)}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === page ? 18 : 6,
                backgroundColor: i === page ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.22)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
