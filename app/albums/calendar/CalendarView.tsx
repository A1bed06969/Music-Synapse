'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatDate } from '@/utils/format'

export type CalendarAlbum = {
  id: string
  title: string
  jacketUrl: string | null
  releaseDate: string
  artistName: string
  genres: string[]
}

const WEEKDAY_LABEL_JA = ['日', '月', '火', '水', '木', '金', '土']

export default function CalendarView({
  month,
  monthLabel,
  prevMonthHref,
  nextMonthHref,
  albums,
}: {
  month: string
  monthLabel: string
  prevMonthHref: string
  nextMonthHref: string
  albums: CalendarAlbum[]
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

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

  const selectedAlbums = selectedDate ? (albumsByDate.get(selectedDate) ?? []) : []

  return (
    <div className="mt-8 flex flex-col gap-6 lg:flex-row">
      <div className="lg:flex-1">
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
            const dayAlbums = albumsByDate.get(cell.date) ?? []
            const first = dayAlbums[0]
            const isSelected = selectedDate === cell.date

            return (
              <button
                key={cell.date}
                type="button"
                disabled={dayAlbums.length === 0}
                onClick={() => setSelectedDate(cell.date)}
                className={`relative aspect-square overflow-hidden rounded-md border text-left transition ${
                  isSelected ? 'border-white' : 'border-white/10'
                } ${dayAlbums.length > 0 ? 'hover:border-white/40' : 'cursor-default'}`}
              >
                {first?.jacketUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={first.jacketUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-50"
                  />
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

      {selectedDate && (
        <div className="lg:w-80 lg:shrink-0">
          <div className="rounded-lg border border-white/10 bg-white/[0.03]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-medium">{formatDate(selectedDate)}の新譜</h3>
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                aria-label="閉じる"
                className="text-lg leading-none text-white/40 transition hover:text-white"
              >
                ×
              </button>
            </div>
            <ul className="max-h-[600px] divide-y divide-white/5 overflow-y-auto">
              {selectedAlbums.map((album) => (
                <li key={album.id}>
                  <Link href={`/albums/${album.id}`} className="flex gap-3 p-3 transition hover:bg-white/5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-white/5">
                      {album.jacketUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={album.jacketUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-white/20">
                          No Art
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{album.title}</p>
                      <p className="truncate text-xs text-white/50">{album.artistName}</p>
                      <p className="mt-0.5 text-xs text-white/30">{album.releaseDate.slice(0, 4)}年</p>
                      {album.genres.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {album.genres.map((g) => (
                            <span
                              key={g}
                              className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
