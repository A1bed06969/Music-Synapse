'use client'

import Link from 'next/link'
import { useMemo } from 'react'

export type CalendarAlbum = {
  id: string
  title: string
  jacketUrl: string | null
  releaseDate: string
  artistName: string
  genres: string[]
}

const WEEKDAY_LABEL_JA = ['日', '月', '火', '水', '木', '金', '土']

/** 月カレンダーのグリッド表示専用コンポーネント。選択中の日付・クリック時の
 * 挙動は親(CalendarPageClient)から受け取る(結果パネルは右カラムのAlbumListPanel
 * が別途担当するため、ここでは持たない)。 */
export default function CalendarView({
  month,
  monthLabel,
  prevMonthHref,
  nextMonthHref,
  albums,
  selectedDate,
  onSelectDate,
}: {
  month: string
  monthLabel: string
  prevMonthHref: string
  nextMonthHref: string
  albums: CalendarAlbum[]
  selectedDate: string | null
  onSelectDate: (date: string) => void
}) {
  const albumsByDate = useMemo(() => {
    const map = new Map<string, CalendarAlbum[]>()
    for (const album of albums) {
      const list = map.get(album.releaseDate) ?? []
      list.push(album)
      map.set(album.releaseDate, list)
    }
    return map
  }, [albums])

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const leadingBlanks = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    const result: { date: string; day: number }[] = []
    for (let i = 0; i < leadingBlanks; i++) result.push({ date: '', day: 0 })
    for (let d = 1; d <= daysInMonth; d++) {
      result.push({ date: `${month}-${String(d).padStart(2, '0')}`, day: d })
    }
    return result
  }, [month])

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <Link
          href={prevMonthHref}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm transition hover:bg-white/5"
        >
          ← 前月
        </Link>
        <h2 className="text-lg font-bold">{monthLabel}</h2>
        <Link
          href={nextMonthHref}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm transition hover:bg-white/5"
        >
          翌月 →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs text-white/40">
        {WEEKDAY_LABEL_JA.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell.date) return <div key={`blank-${i}`} />
          const isSelected = selectedDate === cell.date
          const dayAlbums = albumsByDate.get(cell.date) ?? []
          const first = dayAlbums[0]
          return (
            <button
              key={cell.date}
              type="button"
              disabled={dayAlbums.length === 0}
              onClick={() => onSelectDate(cell.date)}
              className={`relative aspect-square overflow-hidden rounded-md border text-left transition ${
                isSelected ? 'border-white' : 'border-white/10'
              } ${dayAlbums.length > 0 ? 'hover:border-white/40' : 'cursor-default'}`}
            >
              {first?.jacketUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={first.jacketUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
              ) : (
                <div className="absolute inset-0 bg-white/[0.03]" />
              )}
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] leading-tight text-white/80">
                {cell.day}
              </span>
              {dayAlbums.length > 1 && (
                <span className="absolute bottom-1 right-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold leading-none text-black">
                  {dayAlbums.length}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
