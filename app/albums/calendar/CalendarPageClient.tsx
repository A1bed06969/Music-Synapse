'use client'

import { useMemo, useState, useTransition } from 'react'
import DetailPageShell from '@/app/components/detail/DetailPageShell'
import BackLink from '@/app/components/navigation/BackLink'
import CalendarView, { type CalendarAlbum } from './CalendarView'
import RecentReleasesCarousel, { type RecentReleaseAlbum } from './RecentReleasesCarousel'
import AlbumDetailCard from './AlbumDetailCard'
import AlbumListPanel from './AlbumListPanel'
import PageTitleHeading from '@/app/components/detail/PageTitleHeading'
import { getAlbumDetailForCalendar } from './actions'

/** 新譜カレンダーページの3カラムシェル。
 * - 左: 見出し + アルバム詳細(デフォルトは「今週の新譜ピックアップ」カルーセル、
 *   右カラムでアルバムを選ぶとそのアルバム単体の詳細に切り替わる)
 * - 中央: カレンダーのみ(固定)
 * - 右: 日付別の新譜一覧(デフォルトは直近の新譜)
 * 中央の選択日付と右の一覧、右で選んだアルバムと左の詳細、という2系統の
 * state連携が必要なため、DetailPageShellをこの1つのクライアントコンポーネント
 * の中に置いてまとめて管理している(page.tsx自体はServer Componentでstateを
 * 持てないため)。 */
export default function CalendarPageClient({
  month,
  monthLabel,
  prevMonthHref,
  nextMonthHref,
  albums,
  recentReleases,
}: {
  month: string
  monthLabel: string
  prevMonthHref: string
  nextMonthHref: string
  albums: CalendarAlbum[]
  recentReleases: RecentReleaseAlbum[]
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<RecentReleaseAlbum | null>(null)
  const [isPending, startTransition] = useTransition()

  const albumsByDate = useMemo(() => {
    const map = new Map<string, CalendarAlbum[]>()
    for (const album of albums) {
      const list = map.get(album.releaseDate) ?? []
      list.push(album)
      map.set(album.releaseDate, list)
    }
    return map
  }, [albums])

  const selectedAlbums = selectedDate ? (albumsByDate.get(selectedDate) ?? []) : []
  const defaultAlbums = recentReleases.map((a) => ({
    id: a.id,
    title: a.title,
    jacketUrl: a.jacketUrl,
    releaseDate: a.releaseDate,
    artistName: a.artistName,
  }))

  function handleSelectAlbum(albumId: string) {
    setSelectedAlbumId(albumId)
    startTransition(async () => {
      const detail = await getAlbumDetailForCalendar(albumId)
      setSelectedAlbumDetail(detail)
    })
  }

  function handleBackToPicks() {
    setSelectedAlbumId(null)
    setSelectedAlbumDetail(null)
  }

  return (
    <DetailPageShell
      topBar={<BackLink fallbackHref="/albums" fallbackLabel="アルバム一覧に戻る" />}
      left={
        <div className="mt-4">
          <PageTitleHeading
            index="01"
            titleLines={['Discover', 'New Music']}
            accent="#5b8def"
            description="リリース日ごとに新譜をカレンダー表示します。日付をクリックすると右側に一覧、アルバムをクリックすると詳細が表示されます。"
          />

          <div className="mt-8">
            {selectedAlbumId ? (
              <>
                <button
                  type="button"
                  onClick={handleBackToPicks}
                  className="mb-3 text-xs text-white/40 transition hover:text-white"
                >
                  ← 今週の新譜ピックアップに戻る
                </button>
                {isPending || !selectedAlbumDetail ? (
                  <div className="animate-pulse rounded-lg border border-white/10 bg-white/[0.02] p-4">
                    <div className="mb-4 aspect-square w-full max-w-[220px] rounded-lg bg-white/5" />
                    <div className="h-4 w-2/3 rounded bg-white/5" />
                    <div className="mt-2 h-3 w-1/3 rounded bg-white/5" />
                  </div>
                ) : (
                  <AlbumDetailCard album={selectedAlbumDetail} showJacket />
                )}
              </>
            ) : (
              <RecentReleasesCarousel albums={recentReleases} />
            )}
          </div>
        </div>
      }
      center={
        <CalendarView
          month={month}
          monthLabel={monthLabel}
          prevMonthHref={prevMonthHref}
          nextMonthHref={nextMonthHref}
          albums={albums}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      }
      right={
        <AlbumListPanel
          selectedDate={selectedDate}
          selectedAlbums={selectedAlbums}
          defaultAlbums={defaultAlbums}
          selectedAlbumId={selectedAlbumId}
          onClearSelection={() => setSelectedDate(null)}
          onSelectAlbum={handleSelectAlbum}
        />
      }
    />
  )
}
