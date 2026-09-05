import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import SearchableSelect from '../../../../SearchableSelect'
import { searchArtists } from '../../../../actions'
import FestivalLineupExtractor from './FestivalLineupExtractor'
import {
  updateEvent,
  deleteEvent,
  createEventVenue,
  updateEventVenue,
  deleteEventVenue,
  createFestivalEdition,
  deleteFestivalEdition,
  createFestivalAppearance,
  deleteFestivalAppearance,
  createFestivalEditionDates,
  deleteFestivalEditionDate,
  type FestivalExtractResult,
} from '../../../actions'

const EVENT_TYPE_OPTIONS = [
  { value: 'festival', label: 'フェス' },
  { value: 'one_off_live', label: '単発イベント' },
  { value: 'tour', label: 'ツアー' },
  { value: 'other', label: 'その他' },
]

// DBにはJST(+09:00)付きで保存されているが、SupabaseはUTCのISO文字列として
// 返すため、datetime-local入力欄に渡す前にJSTの壁時計時刻に戻す必要がある。
function toJstDatetimeLocal(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error } = await searchParams
  const supabase = await createClient()

  type AppearanceRow = {
    id: number
    event_edition_id: string
    stage: string | null
    venue: string | null
    start_time: string | null
    end_time: string | null
    is_headliner: boolean
    artist_id: string
    artist: { id: string; name: string } | { id: string; name: string }[] | null
  }

  type EditionDateRow = { id: string; event_edition_id: string; date: string; venue: string; region: string | null }

  const editionIds = (await supabase.from('event_edition').select('id').eq('event_id', id)).data?.map((e) => e.id) ?? []

  const [
    { data: entry, error: fetchError },
    { data: genres },
    { data: venues },
    { data: editions },
    { data: appearances },
    { data: editionDates },
    { data: extractPending },
    { data: artistLinks },
  ] = await Promise.all([
    supabase
      .from('event')
      .select(
        'id, name, name_ja, event_type, founded_year, country, prefecture, description, genre_id, image_url, official_site_url, official_youtube_url'
      )
      .eq('id', id)
      .single(),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('event_venue').select('id, name, address').eq('event_id', id).order('sort_order'),
    supabase.from('event_edition').select('id, year, start_date, end_date, venue, description').eq('event_id', id).order('year', { ascending: false }),
    supabase
      .from('event_appearance')
      .select(
        'id, event_edition_id, stage, venue, start_time, end_time, is_headliner, artist_id, artist:artist_id(id, name)'
      )
      .in('event_edition_id', editionIds)
      .order('start_time', { ascending: true }),
    supabase
      .from('event_edition_date')
      .select('id, event_edition_id, date, venue, region')
      .in('event_edition_id', editionIds)
      .order('date', { ascending: true }),
    supabase.from('festival_extract_pending').select('event_edition_id, result').in('event_edition_id', editionIds),
    // FestivalLineupExtractorはevent_edition_idをdatasetKey代わりに使って
    // importAndRegisterFestivalArtistを呼ぶため、ここに「サイト表記(pick_name)→
    // 実際に登録したartist_id」の確定した記録が残る。event_appearance側の
    // アーティスト名(Apple Music側の正式表記)と、サイトの生表記が一致しない
    // ケース(例:「平井大」→実際の登録名「平井 大」)でも、表記ゆれに関係なく
    // 確実に「この表記は登録済み」と判定できる。
    supabase.from('festival_pilot_artist_link').select('dataset_key, pick_name').in('dataset_key', editionIds),
  ])

  if (fetchError || !entry) {
    notFound()
  }

  const appearancesByEdition = new Map<string, AppearanceRow[]>()
  for (const row of (appearances ?? []) as AppearanceRow[]) {
    if (!appearancesByEdition.has(row.event_edition_id)) appearancesByEdition.set(row.event_edition_id, [])
    appearancesByEdition.get(row.event_edition_id)!.push(row)
  }

  // 画面遷移・再読み込みでAI抽出結果が消えないよう、event_edition_idごとに
  // キャッシュ済みの抽出結果をFestivalLineupExtractorへ初期値として渡す
  const pendingByEdition = new Map<string, FestivalExtractResult>()
  for (const row of extractPending ?? []) {
    pendingByEdition.set(row.event_edition_id, row.result as FestivalExtractResult)
  }

  // 再抽出した候補が、既にこのeventEditionへ出演登録済みのアーティストと
  // 重複しないよう、正規化した名前の集合を渡す。event_appearance側の
  // アーティスト名(Apple Music正式表記)による判定に加えて、
  // festival_pilot_artist_link側のpick_name(サイトの生表記そのもの、
  // FestivalLineupExtractorがdatasetKey=event_edition_idで登録したもの)も
  // 合わせる。前者だけだと表記ゆれ(例:「平井大」→「平井 大」)で不一致になり
  // 実際は登録済みでも未登録として再表示され続けることがあったため。
  const registeredNamesByEdition = new Map<string, Set<string>>()
  for (const [editionId, rows] of appearancesByEdition) {
    const names = new Set<string>()
    for (const row of rows) {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      if (artist) names.add(artist.name.trim().toUpperCase())
    }
    registeredNamesByEdition.set(editionId, names)
  }
  for (const row of artistLinks ?? []) {
    const names = registeredNamesByEdition.get(row.dataset_key) ?? new Set<string>()
    names.add(row.pick_name)
    registeredNamesByEdition.set(row.dataset_key, names)
  }

  const editionDatesByEdition = new Map<string, EditionDateRow[]>()
  for (const row of (editionDates ?? []) as EditionDateRow[]) {
    if (!editionDatesByEdition.has(row.event_edition_id)) editionDatesByEdition.set(row.event_edition_id, [])
    editionDatesByEdition.get(row.event_edition_id)!.push(row)
  }

  // 連続する日付はまとめて「9/12〜9/13」のように1つのラウンドとして表示する
  // (登録はrangeでまとめて行ったか単発ずつ行ったかに関わらず、見た目は統一する)
  function groupConsecutiveDates(rows: EditionDateRow[]): { start: EditionDateRow; end: EditionDateRow; ids: string[] }[] {
    const groups: { start: EditionDateRow; end: EditionDateRow; ids: string[] }[] = []
    for (const row of rows) {
      const last = groups[groups.length - 1]
      const prevDay = new Date(`${row.date}T00:00:00Z`)
      prevDay.setUTCDate(prevDay.getUTCDate() - 1)
      const prevDayStr = prevDay.toISOString().slice(0, 10)
      if (last && last.end.date === prevDayStr && last.end.venue === row.venue && last.end.region === row.region) {
        last.end = row
        last.ids.push(row.id)
      } else {
        groups.push({ start: row, end: row, ids: [row.id] })
      }
    }
    return groups
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">フェスを編集</h1>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      {/* 基本情報 */}
      <form action={updateEvent} className="mt-6 space-y-2">
        <input type="hidden" name="id" value={entry.id} />
        <div className="flex flex-wrap gap-2">
          <input
            name="name"
            placeholder="正式名称(例: FUJI ROCK FESTIVAL)"
            required
            defaultValue={entry.name}
            className={`${inputClass} max-w-xs`}
          />
          <input
            name="name_ja"
            placeholder="略称・日本語名(任意・例: フジロック)"
            defaultValue={entry.name_ja ?? ''}
            className={`${inputClass} max-w-[200px]`}
          />
          <select name="event_type" className={`${inputClass} max-w-[140px]`} defaultValue={entry.event_type ?? ''}>
            <option value="">種別(任意)</option>
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            name="founded_year"
            type="number"
            placeholder="発祥年(任意)"
            defaultValue={entry.founded_year ?? ''}
            className={`${inputClass} max-w-[140px]`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <input name="country" placeholder="国(任意)" defaultValue={entry.country ?? ''} className={`${inputClass} max-w-[160px]`} />
          <input
            name="prefecture"
            placeholder="都道府県(任意)"
            defaultValue={entry.prefecture ?? ''}
            className={`${inputClass} max-w-[160px]`}
          />
          <select name="genre_id" className={`${inputClass} max-w-[160px]`} defaultValue={entry.genre_id ?? ''}>
            <option value="">ジャンル(任意)</option>
            {(genres ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <input
          name="image_url"
          placeholder="キービジュアル画像URL(任意)"
          defaultValue={entry.image_url ?? ''}
          className={inputClass}
        />
        <div className="flex flex-wrap gap-2">
          <input
            name="official_site_url"
            placeholder="公式サイトURL(任意)"
            defaultValue={entry.official_site_url ?? ''}
            className={`${inputClass} max-w-xs`}
          />
          <input
            name="official_youtube_url"
            placeholder="公式YouTube URL(任意)"
            defaultValue={entry.official_youtube_url ?? ''}
            className={`${inputClass} max-w-xs`}
          />
        </div>
        <input
          name="description"
          placeholder="概要(任意)"
          defaultValue={entry.description ?? ''}
          className={inputClass}
        />
        <button type="submit" className={buttonClass}>
          基本情報を更新する
        </button>
      </form>

      {/* 会場・住所 */}
      <section className="mt-10 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-lg font-bold">会場・住所</h2>
        <p className="mt-1 text-xs text-white/40">
          複数会場のフェスの場合、行を追加して全て登録できます。開催年ごとに会場が変わる場合は下の「開催年」の会場欄で記録してください。
        </p>

        <ul className="mt-4 space-y-2">
          {(venues ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 p-2">
              <form action={updateEventVenue} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="event_id" value={entry.id} />
                <input name="name" defaultValue={v.name} className={`${inputClass} max-w-[220px]`} />
                <input name="address" placeholder="住所" defaultValue={v.address ?? ''} className={`${inputClass} max-w-sm`} />
                <button type="submit" className={buttonClass}>
                  更新
                </button>
              </form>
              <form action={deleteEventVenue}>
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="event_id" value={entry.id} />
                <button type="submit" className="text-xs text-red-400/70 hover:text-red-400">
                  削除
                </button>
              </form>
            </li>
          ))}
          {(venues ?? []).length === 0 && <p className="text-xs text-white/30">まだ会場が登録されていません。</p>}
        </ul>

        <form action={createEventVenue} className="mt-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="event_id" value={entry.id} />
          <input name="name" placeholder="会場名(例: 苗場スキー場)" required className={`${inputClass} max-w-[220px]`} />
          <input name="address" placeholder="住所(任意)" className={`${inputClass} max-w-sm`} />
          <button type="submit" className={buttonClass}>
            会場を追加
          </button>
        </form>
      </section>

      {/* 開催年・タイムテーブル */}
      <section className="mt-10 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-lg font-bold">開催年・タイムテーブル</h2>
        <p className="mt-1 text-xs text-white/40">
          出演情報(タイムテーブル)を登録するには、まず開催年を作成してください。
        </p>

        <div className="mt-4 space-y-6">
          {(editions ?? []).map((ed) => {
            const editionAppearances = appearancesByEdition.get(ed.id) ?? []
            return (
              <div key={ed.id} className="rounded-md border border-white/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold">{ed.year}年</span>
                    {ed.start_date && (
                      <span className="ml-2 text-white/50">
                        {ed.start_date}
                        {ed.end_date ? `〜${ed.end_date}` : ''}
                      </span>
                    )}
                    {ed.venue && <span className="ml-2 text-white/50">@ {ed.venue}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/data/events/edition/${ed.id}/edit`}
                      className="text-xs text-white/40 hover:text-white/70"
                    >
                      年の詳細を編集 →
                    </Link>
                    <form action={deleteFestivalEdition}>
                      <input type="hidden" name="id" value={ed.id} />
                      <input type="hidden" name="event_id" value={entry.id} />
                      <button type="submit" className="text-xs text-red-400/70 hover:text-red-400">
                        この年を削除
                      </button>
                    </form>
                  </div>
                </div>

                {/* ロック・イン・ジャパンのように同じ年で2ラウンド(週)に分かれる
                 * フェスに対応するため、上のstart_date/end_dateとは別に、開催
                 * ラウンドを何回でも追加登録できるようにする */}
                <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-2.5">
                  <p className="text-xs font-medium text-white/60">開催ラウンド(2週開催などで期間が分かれる場合)</p>
                  {(() => {
                    const groups = groupConsecutiveDates(editionDatesByEdition.get(ed.id) ?? [])
                    return groups.length === 0 ? (
                      <p className="mt-1.5 text-xs text-white/30">まだ個別の開催日程が登録されていません。</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1">
                        {groups.map((g, i) => (
                          <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
                            <span>
                              {g.start.date}
                              {g.end.date !== g.start.date ? `〜${g.end.date}` : ''} @ {g.start.venue}
                              {g.start.region ? `(${g.start.region})` : ''}
                            </span>
                            <form action={deleteFestivalEditionDate}>
                              {g.ids.map((gid) => (
                                <input key={gid} type="hidden" name="id" value={gid} />
                              ))}
                              <input type="hidden" name="event_id" value={entry.id} />
                              <button type="submit" className="text-red-400/70 hover:text-red-400">
                                削除
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )
                  })()}
                  <form action={createFestivalEditionDates} className="mt-2 flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="event_id" value={entry.id} />
                    <input type="hidden" name="event_edition_id" value={ed.id} />
                    <input name="start_date" type="date" required className={`${inputClass} max-w-[150px]`} />
                    <span className="text-xs text-white/30">〜</span>
                    <input name="end_date" type="date" placeholder="単日ならなくてOK" className={`${inputClass} max-w-[150px]`} />
                    <input name="venue" placeholder="会場" required className={`${inputClass} max-w-[160px]`} />
                    <input name="region" placeholder="都市(任意)" className={`${inputClass} max-w-[120px]`} />
                    <button type="submit" className={buttonClass}>
                      ラウンドを追加
                    </button>
                  </form>
                </div>

                <ul className="mt-3 space-y-1.5 text-sm">
                  {editionAppearances.map((a) => {
                    const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-white/80">
                        <span>
                          {a.is_headliner && <span className="mr-1 text-amber-400">★</span>}
                          <Link href={`/artists/${a.artist_id}`} className="hover:underline">
                            {artist?.name ?? '?'}
                          </Link>
                          {a.stage && <span className="ml-2 text-xs text-white/40">{a.stage}</span>}
                          {(a.start_time || a.end_time) && (
                            <span className="ml-2 text-xs text-white/40">
                              {a.start_time ? toJstDatetimeLocal(a.start_time).replace('T', ' ') : ''}
                              {a.end_time ? ` 〜 ${toJstDatetimeLocal(a.end_time).replace('T', ' ')}` : ''}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <Link
                            href={`/admin/data/events/appearance/${a.id}/edit`}
                            className="text-xs text-white/40 hover:text-white/70"
                          >
                            編集 →
                          </Link>
                          <form action={deleteFestivalAppearance}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="event_id" value={entry.id} />
                            <input type="hidden" name="artist_id" value={a.artist_id} />
                            <button type="submit" className="text-xs text-red-400/70 hover:text-red-400">
                              削除
                            </button>
                          </form>
                        </span>
                      </li>
                    )
                  })}
                  {editionAppearances.length === 0 && (
                    <p className="text-xs text-white/30">まだ出演情報が登録されていません。</p>
                  )}
                </ul>

                <form action={createFestivalAppearance} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="event_id" value={entry.id} />
                  <input type="hidden" name="event_edition_id" value={ed.id} />
                  <SearchableSelect searchAction={searchArtists} name="artist_id" placeholder="出演アーティストを検索..." />
                  <input name="stage" placeholder="ステージ名(任意)" className={`${inputClass} max-w-[140px]`} />
                  <input name="venue" placeholder="会場(任意・複数会場の場合)" className={`${inputClass} max-w-[200px]`} />
                  <input name="start_time" type="datetime-local" className={`${inputClass} max-w-[190px]`} />
                  <input name="end_time" type="datetime-local" className={`${inputClass} max-w-[190px]`} />
                  <label className="flex items-center gap-1.5 text-xs text-white/60">
                    <input name="is_headliner" type="checkbox" className="h-3.5 w-3.5" />
                    ヘッドライナー
                  </label>
                  <button type="submit" className={buttonClass}>
                    出演を追加
                  </button>
                </form>

                <FestivalLineupExtractor
                  eventId={entry.id}
                  eventEditionId={ed.id}
                  initialResult={pendingByEdition.get(ed.id) ?? null}
                  registeredArtistNames={Array.from(registeredNamesByEdition.get(ed.id) ?? [])}
                />
              </div>
            )
          })}
          {(editions ?? []).length === 0 && <p className="text-xs text-white/30">まだ開催年が登録されていません。</p>}
        </div>

        <form action={createFestivalEdition} className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          <input type="hidden" name="event_id" value={entry.id} />
          <input name="year" type="number" placeholder="開催年(例: 2026)" required className={`${inputClass} max-w-[120px]`} />
          <input name="start_date" type="date" className={`${inputClass} max-w-[160px]`} />
          <input name="end_date" type="date" className={`${inputClass} max-w-[160px]`} />
          <input name="venue" placeholder="この年の会場(任意)" className={`${inputClass} max-w-[220px]`} />
          <input name="description" placeholder="概要(任意)" className={`${inputClass} max-w-xs`} />
          <button type="submit" className={buttonClass}>
            開催年を追加
          </button>
        </form>
      </section>

      <form action={deleteEvent} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          このイベントを削除
        </button>
      </form>
    </div>
  )
}
