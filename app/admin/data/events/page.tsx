import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../adminUi'
import {
  createEvent,
  createEventEdition,
  createEventEditionDate,
  createEventAppearance,
  createMusicEvent,
} from './actions'

const EVENT_TYPE_OPTIONS = [
  { value: 'festival', label: 'フェス' },
  { value: 'one_off_live', label: '単発イベント' },
  { value: 'tour', label: 'ツアー' },
  { value: 'other', label: 'その他' },
]

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  tour: 'ツアー',
  other: 'その他',
}

export default async function EventsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [
    { data: artists },
    { data: genres },
    { data: events },
    { data: eventEditions },
    { data: eventEditionDates },
    { data: eventAppearances },
    { data: musicEvents },
  ] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('event').select('id, name, event_type').order('name'),
    supabase.from('event_edition').select('id, year, event:event_id(name)').order('year', { ascending: false }),
    supabase
      .from('event_edition_date')
      .select('id, date, venue, region, event_edition:event_edition_id(year, event:event_id(name))')
      .order('date', { ascending: true }),
    supabase
      .from('event_appearance')
      .select(
        'id, stage, venue, is_headliner, artist:artist_id(name), event_edition:event_edition_id(year, event:event_id(name))'
      )
      .order('id', { ascending: false }),
    supabase
      .from('music_event')
      .select('id, name, event_date, artist:artist_id(name)')
      .order('id', { ascending: false }),
  ])

  const artistOptions = artists ?? []
  const genreOptions = genres ?? []
  const eventOptions = events ?? []
  const eventEditionOptions = (eventEditions ?? []).map((row) => {
    const event = Array.isArray(row.event) ? row.event[0] : row.event
    return { id: row.id, label: `${event?.name ?? '?'}(${row.year})` }
  })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
          ← 管理画面に戻る
        </Link>
        <Link href="/admin/data/events/festival-pilot" className="text-xs text-white/40 hover:text-white/70">
          世界のフェス出演者収集(パイロット) →
        </Link>
      </div>

      <h1 className="mt-4 text-2xl font-bold">イベント</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createEvent} className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input name="name" placeholder="イベント名(例: FUJI ROCK FESTIVAL)" required className={`${inputClass} max-w-xs`} />
          <input name="name_ja" placeholder="略称・日本語名(任意・例: フジロック)" className={`${inputClass} max-w-[200px]`} />
          <select name="event_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">種別(任意)</option>
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input name="founded_year" type="number" placeholder="発祥年(任意)" className={`${inputClass} max-w-[140px]`} />
        </div>
        <div className="flex flex-wrap gap-2">
          <input name="country" placeholder="国(任意)" className={`${inputClass} max-w-[160px]`} />
          <input name="prefecture" placeholder="都道府県(任意)" className={`${inputClass} max-w-[160px]`} />
          <select name="genre_id" className={`${inputClass} max-w-[160px]`} defaultValue="">
            <option value="">ジャンル(任意)</option>
            {genreOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <input name="image_url" placeholder="キービジュアル画像URL(任意)" className={inputClass} />
        <div className="flex flex-wrap gap-2">
          <input name="official_site_url" placeholder="公式サイトURL(任意)" className={`${inputClass} max-w-xs`} />
          <input name="official_youtube_url" placeholder="公式YouTube URL(任意)" className={`${inputClass} max-w-xs`} />
        </div>
        <input name="description" placeholder="概要(任意)" className={inputClass} />
        <button type="submit" className={buttonClass}>
          イベントを追加
        </button>
      </form>

      {events && events.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span>
                {e.name}
                {e.event_type && <span className="text-white/30"> ({EVENT_TYPE_LABEL[e.event_type] ?? e.event_type})</span>}
              </span>
              <Link href={`/admin/data/events/event/${e.id}/edit`} className="shrink-0 text-xs text-white/40 hover:text-white/70">
                編集 →
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form action={createEventEdition} className="mt-6 flex flex-wrap gap-2">
        <select name="event_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            イベントを選択
          </option>
          {eventOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input name="year" type="number" placeholder="年" required className={`${inputClass} max-w-[100px]`} />
        <input name="start_date" type="date" className={`${inputClass} max-w-[160px]`} />
        <input name="end_date" type="date" className={`${inputClass} max-w-[160px]`} />
        <input name="venue" placeholder="会場(任意)" className={`${inputClass} max-w-xs`} />
        <button type="submit" className={buttonClass}>
          開催回を追加
        </button>
      </form>

      {eventEditions && eventEditions.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {eventEditions.map((row) => {
            const event = Array.isArray(row.event) ? row.event[0] : row.event
            return (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {event?.name}({row.year})
                </span>
                <Link
                  href={`/admin/data/events/edition/${row.id}/edit`}
                  className="shrink-0 text-xs text-white/40 hover:text-white/70"
                >
                  編集 →
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <h2 className="mt-8 text-sm font-semibold text-white/70">開催日程・会場</h2>
      <p className="mt-1 text-xs text-white/40">
        サマーソニックのように日によって会場が異なるフェスや、複数都市を回るライブツアーなど、1つの開催回の中で日付・会場が複数ある場合にここで個別に登録する。アーティストの出演情報とは独立して登録できる。東京・大阪のように同日程で複数都市が同時開催される場合は都市名も入力すると、イベント詳細ページで都市ごとにタブ分けして表示される。
      </p>
      <form action={createEventEditionDate} className="mt-3 flex flex-wrap gap-2">
        <select name="event_edition_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            開催回を選択
          </option>
          {eventEditionOptions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
        <input name="date" type="date" required className={`${inputClass} max-w-[160px]`} />
        <input name="venue" placeholder="会場(例: 幕張メッセ)" required className={`${inputClass} max-w-xs`} />
        <input name="region" placeholder="都市(任意・例: 東京)" className={`${inputClass} max-w-[140px]`} />
        <button type="submit" className={buttonClass}>
          開催日程を追加
        </button>
      </form>

      {eventEditionDates && eventEditionDates.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {eventEditionDates.map((row) => {
            const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
            const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
            return (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {event?.name}({edition?.year}) — {row.date} @ {row.venue}
                  {row.region ? `(${row.region})` : ''}
                </span>
                <Link
                  href={`/admin/data/events/edition-date/${row.id}/edit`}
                  className="shrink-0 text-xs text-white/40 hover:text-white/70"
                >
                  編集 →
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <form action={createEventAppearance} className="mt-6 flex flex-wrap items-center gap-2">
        <select name="event_edition_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            開催回を選択
          </option>
          {eventEditionOptions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">に</span>
        <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            アーティストを選択
          </option>
          {artistOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">が出演</span>
        <input name="stage" placeholder="ステージ名(任意)" className={`${inputClass} max-w-[160px]`} />
        <input name="venue" placeholder="会場(任意・複数会場フェスの場合のみ)" className={`${inputClass} max-w-[220px]`} />
        <input name="start_time" type="datetime-local" className={`${inputClass} max-w-[200px]`} />
        <input name="end_time" type="datetime-local" className={`${inputClass} max-w-[200px]`} />
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input name="is_headliner" type="checkbox" className="h-3.5 w-3.5" />
          ヘッドライナー
        </label>
        <button type="submit" className={buttonClass}>
          出演情報を追加
        </button>
      </form>

      {eventAppearances && eventAppearances.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {eventAppearances.map((row) => {
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const edition = Array.isArray(row.event_edition) ? row.event_edition[0] : row.event_edition
            const event = edition ? (Array.isArray(edition.event) ? edition.event[0] : edition.event) : null
            return (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {artist?.name} — {event?.name}({edition?.year})
                  {row.stage ? ` / ${row.stage}` : ''}
                  {row.venue ? ` @ ${row.venue}` : ''}
                  {row.is_headliner && <span className="text-white/30"> ★ヘッドライナー</span>}
                </span>
                <Link
                  href={`/admin/data/events/appearance/${row.id}/edit`}
                  className="shrink-0 text-xs text-white/40 hover:text-white/70"
                >
                  編集 →
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <form action={createMusicEvent} className="mt-6 flex flex-wrap gap-2">
        <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            アーティストを選択
          </option>
          {artistOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input name="name" placeholder="公演名(例: ○○ホール ワンマンライブ)" required className={`${inputClass} max-w-xs`} />
        <input name="event_date" type="date" className={`${inputClass} max-w-[160px]`} />
        <input name="venue" placeholder="会場(任意)" className={`${inputClass} max-w-xs`} />
        <input name="prefecture" placeholder="都道府県(任意)" className={`${inputClass} max-w-[160px]`} />
        <button type="submit" className={buttonClass}>
          単独公演を追加
        </button>
      </form>

      {musicEvents && musicEvents.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {musicEvents.map((row) => {
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            return (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {artist?.name} — {row.name}
                  {row.event_date ? `(${row.event_date})` : ''}
                </span>
                <Link
                  href={`/admin/data/events/music-event/${row.id}/edit`}
                  className="shrink-0 text-xs text-white/40 hover:text-white/70"
                >
                  編集 →
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
