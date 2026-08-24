import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { extractYoutubeVideoId } from '@/utils/format'
import type { MapMarker } from '@/app/map/LeafletMap'
import { NEWS_SOURCES } from '@/utils/newsFeeds'
import { fetchAllNews, findRelatedNews, formatRelativeTime } from '@/utils/newsParser'
import EventScheduleView, { type Appearance, type EditionDateEntry } from './EventScheduleView'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  tour: 'ツアー',
  other: 'その他',
}

// DBにはJST(+09:00)付きで保存されているが、event_appearance.start_time/end_timeは
// timestamptz列のためSupabase/PostgRESTはUTCのISO文字列として返す(+09:00が
// 失われる)。素の.slice(11,16)だとUTC時刻がそのまま「JSTの時刻」として表示され、
// 実際より9時間早い時刻になってしまう(app/admin/data/events/appearance/[id]/edit/
// page.tsxのtoJstDatetimeLocalと対になる変換が必要)。
function toHHMM(isoStr: string): string {
  const date = new Date(isoStr)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

/** イベントの画像を、出典(公式サイト or 公式YouTube)へのリンク付きで表示する。
 * 著作権的に問題が起きにくいよう、画像は必ずその出典元へ戻れる形にする。
 * image_urlが無い場合はofficial_youtube_url(動画URL)からサムネイルを導出する
 * フォールバックも用意している(動画しか無いイベント向け)。
 * official_site_urlがあれば、画像とは別に小さな公式サイトリンクも添える。
 * どちらも無ければプレースホルダーを出す */
function EventThumbnail({
  imageUrl,
  youtubeUrl,
  officialSiteUrl,
  eventName,
}: {
  imageUrl: string | null
  youtubeUrl: string | null
  officialSiteUrl: string | null
  eventName: string
}) {
  // image_urlが未設定なら、動画URLからサムネイルを導出するフォールバック
  const videoId = !imageUrl && youtubeUrl ? extractYoutubeVideoId(youtubeUrl) : null
  const displayImageUrl = imageUrl ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null)
  // 画像のリンク先は、その画像の出典元(YouTubeチャンネル/動画があればそちら、
  // 無ければ公式サイト)にする。出典と違う場所へリンクすると「引用」の理屈が弱くなるため
  const imageLinkUrl = youtubeUrl ?? officialSiteUrl
  const sourceLabel = videoId || youtubeUrl ? '公式YouTubeより' : '公式サイトより'

  if (!displayImageUrl) {
    return (
      <div className="flex aspect-video w-full shrink-0 items-center justify-center rounded-lg border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.01] sm:w-96">
        <span className="text-6xl">🎪</span>
      </div>
    )
  }

  return (
    <div className="w-full shrink-0 sm:w-96">
      <a
        href={imageLinkUrl ?? displayImageUrl}
        target="_blank"
        rel="noreferrer"
        className="group relative block aspect-video overflow-hidden rounded-lg border border-white/10 bg-black"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayImageUrl}
          alt={eventName}
          className="h-full w-full object-contain transition group-hover:opacity-80"
        />
        {videoId && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 transition group-hover:bg-black/75">
              <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}
        <span className="absolute bottom-1.5 right-2 text-[10px] text-white/70">{sourceLabel}</span>
      </a>
      {officialSiteUrl && (
        <a
          href={officialSiteUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 block text-center text-xs text-white/40 hover:text-white/70"
        >
          公式サイトへ →
        </a>
      )}
    </div>
  )
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}) {
  const { id } = await params
  const { year: yearParam } = await searchParams
  const supabase = await createClient()

  const { data: event, error } = await supabase
    .from('event')
    .select(
      'id, name, name_ja, event_type, founded_year, country, prefecture, description, official_youtube_url, official_site_url, image_url'
    )
    .eq('id', id)
    .single()

  if (error || !event) {
    notFound()
  }

  // イベント名をタイトルに含む記事をRSS記事から拾う。既存の/media/newsページと
  // 同じfetchAllNewsを再利用する(fetchはnext:{revalidate:1800}でキャッシュされるため、
  // イベントページ側で毎回叩いても実質追加の外部通信は増えない)
  const relatedNewsPromise = fetchAllNews(NEWS_SOURCES).then(({ items }) =>
    findRelatedNews(items, [event.name, event.name_ja].filter((k): k is string => Boolean(k)), 3)
  )

  const { data: editions } = await supabase
    .from('event_edition')
    .select('id, year, start_date, end_date, venue, description')
    .eq('event_id', id)
    .order('year', { ascending: false })

  const editionList = editions ?? []
  const requestedYear = yearParam ? Number(yearParam) : null
  const selectedEdition =
    (requestedYear ? editionList.find((ed) => ed.year === requestedYear) : null) ?? editionList[0] ?? null

  let appearances: Appearance[] = []
  let editionDates: EditionDateEntry[] = []

  if (selectedEdition) {
    const { data: editionDateRows } = await supabase
      .from('event_edition_date')
      .select('id, date, venue, region')
      .eq('event_edition_id', selectedEdition.id)
      .order('date', { ascending: true })
    editionDates = editionDateRows ?? []

    const { data: appearanceRows } = await supabase
      .from('event_appearance')
      .select('id, stage, venue, is_headliner, start_time, end_time, display_name, artist:artist_id(id, name, image_url)')
      .eq('event_edition_id', selectedEdition.id)
      .order('is_headliner', { ascending: false })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })

    // 出演に紐づく全アーティスト(単独出演も含め、コラボの場合は2件以上)を
    // event_appearance_artist経由でまとめて取得し、event_appearance_idごとに束ねる
    const appearanceIds = (appearanceRows ?? []).map((row) => row.id)
    const artistsByAppearanceId = new Map<number, { id: string; name: string; imageUrl: string | null }[]>()
    if (appearanceIds.length > 0) {
      const { data: linkRows } = await supabase
        .from('event_appearance_artist')
        .select('event_appearance_id, billing_order, artist:artist_id(id, name, image_url)')
        .in('event_appearance_id', appearanceIds)
        .order('billing_order', { ascending: true })
      for (const link of linkRows ?? []) {
        const artist = Array.isArray(link.artist) ? link.artist[0] : link.artist
        if (!artist) continue
        const list = artistsByAppearanceId.get(link.event_appearance_id) ?? []
        list.push({ id: artist.id, name: artist.name, imageUrl: artist.image_url })
        artistsByAppearanceId.set(link.event_appearance_id, list)
      }
    }

    appearances = (appearanceRows ?? []).map((row) => {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      // 開催回登録時の仮時刻(正午固定)は「時刻不明」と同じ扱いにする
      const hasRealTime = row.start_time && row.end_time
      const linkedArtists = artistsByAppearanceId.get(row.id)
      const artists = linkedArtists && linkedArtists.length > 0 ? linkedArtists : [{ id: artist?.id ?? '', name: artist?.name ?? '?', imageUrl: artist?.image_url ?? null }]
      return {
        id: row.id,
        stage: row.stage,
        venue: row.venue ?? selectedEdition.venue ?? null,
        isHeadliner: row.is_headliner,
        performanceDate: row.start_time ? row.start_time.slice(0, 10) : null,
        timeLabel: hasRealTime ? `${toHHMM(row.start_time!)}-${toHHMM(row.end_time!)}` : null,
        displayName: row.display_name,
        artists,
      }
    })
  }

  const venueSummary = selectedEdition
    ? (selectedEdition.venue ?? appearances.find((a) => a.venue)?.venue ?? null)
    : null

  // event_edition_date(個別日程・会場)が登録されている開催回は、会場ごとに
  // マーカーを分ける(サマーソニックのように複数会場になる場合があるため)。
  // 登録が無い開催回は従来通りvenueSummary(単一の会場文字列)で1件だけ表示する。
  let venueMarkers: MapMarker[] = []
  if (editionDates.length > 0) {
    const distinctVenues = Array.from(new Set(editionDates.map((ed) => ed.venue)))
    const { data: venueLocations } = await supabase
      .from('venue_location')
      .select('venue_name, latitude, longitude')
      .in('venue_name', distinctVenues)
    venueMarkers = (venueLocations ?? []).map((v) => ({
      id: `venue-${v.venue_name}`,
      latitude: v.latitude,
      longitude: v.longitude,
      color: '#e8a63c',
      popupHtml: v.venue_name,
      category: 'venue' as const,
      label: v.venue_name,
    }))
  } else if (venueSummary) {
    const { data: venueLocation } = await supabase
      .from('venue_location')
      .select('latitude, longitude')
      .eq('venue_name', venueSummary)
      .maybeSingle()
    if (venueLocation) {
      venueMarkers = [
        {
          id: 'venue',
          latitude: venueLocation.latitude,
          longitude: venueLocation.longitude,
          color: '#e8a63c',
          popupHtml: venueSummary,
          category: 'venue',
          label: venueSummary,
        },
      ]
    }
  }

  const relatedNews = await relatedNewsPromise

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧
      </Link>

      <div className="mt-6 flex flex-col gap-6 sm:flex-row">
        <EventThumbnail
          imageUrl={event.image_url}
          youtubeUrl={event.official_youtube_url}
          officialSiteUrl={event.official_site_url}
          eventName={event.name}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/40">
            {event.event_type ? EVENT_TYPE_LABEL[event.event_type] ?? event.event_type : ''}
            {event.founded_year ? ` · ${event.founded_year}年〜` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{event.name}</h1>
          {(event.country || event.prefecture) && (
            <p className="mt-1 text-sm text-white/50">
              {[event.country, event.prefecture].filter(Boolean).join(' / ')}
            </p>
          )}
          {event.description && <p className="mt-3 text-sm leading-relaxed text-white/70">{event.description}</p>}
        </div>
      </div>

      {editionList.length === 0 || !selectedEdition ? (
        <p className="mt-10 text-sm text-white/40">まだ開催情報が登録されていません。</p>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap gap-2">
            {editionList.map((ed) => (
              <Link
                key={ed.id}
                href={`/events/${id}?year=${ed.year}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  ed.year === selectedEdition.year
                    ? 'border-white bg-white text-black'
                    : 'border-white/15 text-white/60 hover:border-white/30'
                }`}
              >
                {ed.year}
              </Link>
            ))}
          </div>

          <EventScheduleView
            editionDates={editionDates}
            editionDescription={selectedEdition.description}
            venueSummary={venueSummary}
            editionStartDate={selectedEdition.start_date}
            editionEndDate={selectedEdition.end_date}
            venueMarkers={venueMarkers}
            appearances={appearances}
          />
        </>
      )}

      {relatedNews.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold">関連ニュース</h2>
          <div className="mt-3 space-y-2 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0">
            {relatedNews.map((item) => (
              <a
                key={item.id}
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-2 transition hover:border-white/30 sm:block sm:overflow-hidden sm:rounded-lg sm:p-0"
              >
                <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-white/5 sm:aspect-video sm:h-auto sm:w-full sm:rounded-none">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20 sm:text-xs">
                      No Image
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 sm:p-3">
                  <p className="line-clamp-2 text-xs font-medium leading-snug sm:text-sm">{item.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40 sm:mt-2 sm:justify-between sm:text-xs">
                    <span>{item.source}</span>
                    <span>{formatRelativeTime(item.publishedAt)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
