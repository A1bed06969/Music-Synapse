'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatDate } from '@/utils/format'

// event_edition(フェスの開催年ごとの日程)由来はkind: 'event'、
// music_event(単発ライブ)由来はkind: 'live'。複数日開催のフェスは
// 該当する日ごとに別エントリとして展開済み(呼び出し側で展開)。
export type CalendarLiveEvent = {
  id: string
  date: string
  kind: 'event' | 'live'
  title: string
  imageUrl: string | null
  venue: string | null
  artistName: string | null
  href: string | null
}

const WEEKDAY_LABEL_JA = ['日', '月', '火', '水', '木', '金', '土']
const KIND_EMOJI: Record<CalendarLiveEvent['kind'], string> = { event: '🎪', live: '🎤' }
const KIND_LABEL: Record<CalendarLiveEvent['kind'], string> = { event: 'フェス', live: 'ライブ' }

export default function EventCalendarView({
  month,
  monthLabel,
  prevMonthHref,
  nextMonthHref,
  events,
}: {
  month: string
  monthLabel: string
  prevMonthHref: string
  nextMonthHref: string
  events: CalendarLiveEvent[]
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarLiveEvent[]>()
    for (const event of events) {
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }
    return map
  }, [events])

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

  const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : []

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-6 lg:flex-row">
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
              const isSelected = selectedDate === cell.date
              const dayEvents = eventsByDate.get(cell.date) ?? []
              const first = dayEvents[0]
              return (
                <button
                  key={cell.date}
                  type="button"
                  disabled={dayEvents.length === 0}
                  onClick={() => setSelectedDate(cell.date)}
                  className={`relative aspect-square overflow-hidden rounded-md border text-left transition ${
                    isSelected ? 'border-white' : 'border-white/10'
                  } ${dayEvents.length > 0 ? 'hover:border-white/40' : 'cursor-default'}`}
                >
                  {first?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={first.imageUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-50"
                    />
                  ) : first ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/[0.03] text-lg">
                      {KIND_EMOJI[first.kind]}
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-white/[0.03]" />
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] leading-tight text-white/80">
                    {cell.day}
                  </span>
                  {dayEvents.length > 1 && (
                    <span className="absolute bottom-1 right-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold leading-none text-black">
                      {dayEvents.length}
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
                <h3 className="text-sm font-medium">{formatDate(selectedDate)}のライブ・フェス</h3>
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
                {selectedEvents.map((event) => {
                  const content = (
                    <div className="flex gap-3 p-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-white/5 text-xl">
                        {event.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={event.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          KIND_EMOJI[event.kind]
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                          {KIND_LABEL[event.kind]}
                        </span>
                        <p className="mt-1 truncate text-sm font-medium">{event.title}</p>
                        {event.artistName && (
                          <p className="truncate text-xs text-white/50">{event.artistName}</p>
                        )}
                        {event.venue && <p className="truncate text-xs text-white/30">{event.venue}</p>}
                      </div>
                    </div>
                  )
                  return (
                    <li key={event.id}>
                      {event.href ? (
                        <Link href={event.href} className="block transition hover:bg-white/5">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
