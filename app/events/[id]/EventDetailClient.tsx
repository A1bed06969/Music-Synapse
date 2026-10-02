'use client'

import Link from 'next/link'
import { useState } from 'react'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import EventIdentityPanel, { type EventIdentityData } from '@/app/components/event-detail/EventIdentityPanel'
import EventScheduleView, {
  type Appearance,
  type EditionDateEntry,
  type EventContentView,
} from './EventScheduleView'
import { formatRelativeTime } from '@/utils/newsParser'
import type { MapMarker } from '@/app/map/LeafletMap'

type EditionSummary = { id: string; year: number }

type RelatedNewsItem = {
  id: string
  link: string
  title: string
  source: string
  publishedAt: string
  thumbnailUrl: string | null
}

const MENU_ITEMS: { view: EventContentView; label: string }[] = [
  { view: 'artists', label: 'アーティスト一覧' },
  { view: 'timetable', label: 'タイムテーブル' },
  { view: 'map', label: 'マップ' },
]

/** イベント詳細ページ全体(topBar/left/center/right)をここでまとめて描画する。
 * 右カラムの表示切替メニューと中央カラムの表示内容がstate(selectedView)を
 * 共有する必要があるため、release calendar(CalendarPageClient.tsx)と同じ理由で
 * ページ全体をクライアントコンポーネント化している(DetailPageShell自体は
 * サーバー/クライアントどちらから呼んでも良いただのレイアウト)。 */
export default function EventDetailClient({
  eventId,
  identity,
  editionList,
  selectedEditionYear,
  scheduleProps,
  relatedNews,
}: {
  eventId: string
  identity: EventIdentityData
  editionList: EditionSummary[]
  selectedEditionYear: number | null
  scheduleProps: {
    editionDates: EditionDateEntry[]
    editionDescription: string | null
    venueSummary: string | null
    editionStartDate: string | null
    editionEndDate: string | null
    venueMarkers: MapMarker[]
    appearances: Appearance[]
  } | null
  relatedNews: RelatedNewsItem[]
}) {
  const [selectedView, setSelectedView] = useState<EventContentView>('artists')

  const newsSection =
    relatedNews.length > 0 ? (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-white/40">関連ニュース</h2>
          <div className="mt-3 space-y-2">
            {relatedNews.map((item) => (
              <a
                key={item.id}
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-2 transition hover:border-white/30"
              >
                <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-white/5">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                      No Image
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs font-medium leading-snug">{item.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40">
                    <span>{item.source}</span>
                    <span>{formatRelativeTime(item.publishedAt)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
    ) : null

  const leftColumn = (
    <div className="flex flex-col gap-8">
      <EventIdentityPanel data={identity} />
      {newsSection}
    </div>
  )

  const editionChips =
    editionList.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {editionList.map((ed) => (
            <Link
              key={ed.id}
              href={`/events/${eventId}?year=${ed.year}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                ed.year === selectedEditionYear
                  ? 'border-white bg-white text-black'
                  : 'border-white/15 text-white/60 hover:border-white/30'
              }`}
            >
              {ed.year}
            </Link>
          ))}
        </div>
    ) : null

  const scheduleContent = !scheduleProps ? (
    <p className="mt-4 text-sm text-white/40">まだ開催情報が登録されていません。</p>
  ) : (
    <div className={editionList.length > 1 ? 'mt-6' : undefined}>
      <EventScheduleView view={selectedView} {...scheduleProps} />
    </div>
  )

  const centerColumn = (
    <div>
      {editionChips}
      {scheduleContent}
    </div>
  )

  // モバイルでは右カラム(縦積みだと最下部に埋もれる)ではなく、パワープレイ
  // ページ(OnAirMobileTabs)と同じセグメントコントロールをタイトル/開催年の
  // 直下に置く。
  const mobileSwitcher = (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
      {MENU_ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          onClick={() => setSelectedView(item.view)}
          disabled={!scheduleProps}
          className={`rounded-md py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
            selectedView === item.view ? 'bg-white text-black' : 'text-white/60 hover:text-white'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )

  const mobileContent = (
    <div className="flex flex-col gap-6">
      <EventIdentityPanel data={identity} />
      {editionChips}
      {mobileSwitcher}
      <div className="min-w-0">{scheduleContent}</div>
      {newsSection}
    </div>
  )

  const rightColumn = (
    <nav className="flex flex-col gap-1">
      <h2 className="mb-1 text-xs uppercase tracking-wide text-white/40">表示切替</h2>
      {MENU_ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          onClick={() => setSelectedView(item.view)}
          disabled={!scheduleProps}
          className={`rounded-md px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
            selectedView === item.view ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )

  return (
    <>
      <StickyMiniHeader watchElementId="event-header" imageUrl={identity.imageUrl} title={identity.name} subtitle={identity.eventTypeLabel} />
      <DetailPageShell
        topBar={<BackLink fallbackHref="/events" fallbackLabel="イベント一覧" />}
        left={leftColumn}
        center={centerColumn}
        right={rightColumn}
        mobileContent={mobileContent}
      />
    </>
  )
}
