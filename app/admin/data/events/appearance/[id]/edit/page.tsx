import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import { updateEventAppearance, deleteEventAppearance, addAppearanceArtist, removeAppearanceArtist } from '../../../actions'

// DBにはJST(+09:00)付きで保存されているが、SupabaseはUTCのISO文字列として
// 返すため、datetime-local入力欄に渡す前にJSTの壁時計時刻に戻す必要がある
// (createEventAppearance/updateEventAppearanceが `${value}:00+09:00` として
// 保存しているのと対になる変換)。
function toJstDatetimeLocal(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
}

export default async function EditEventAppearancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: artists }, { data: eventEditions }, { data: linkedArtists }] = await Promise.all([
    supabase
      .from('event_appearance')
      .select('id, event_edition_id, artist_id, stage, venue, start_time, end_time, is_headliner, display_name')
      .eq('id', id)
      .single(),
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('event_edition').select('id, year, event:event_id(name)').order('year', { ascending: false }),
    supabase
      .from('event_appearance_artist')
      .select('artist_id, billing_order, artist:artist_id(id, name)')
      .eq('event_appearance_id', id)
      .order('billing_order', { ascending: true }),
  ])

  if (error || !entry) {
    notFound()
  }

  const collaborators = (linkedArtists ?? []).map((row) => {
    const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
    return { id: row.artist_id, name: artist?.name ?? '?' }
  })

  const eventEditionOptions = (eventEditions ?? []).map((row) => {
    const event = Array.isArray(row.event) ? row.event[0] : row.event
    return { id: row.id, label: `${event?.name ?? '?'}(${row.year})` }
  })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">出演情報を編集</h1>

      <form action={updateEventAppearance} className="mt-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={entry.id} />
        <select
          name="event_edition_id"
          required
          className={`${inputClass} max-w-xs`}
          defaultValue={entry.event_edition_id}
        >
          {eventEditionOptions.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">に</span>
        <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue={entry.artist_id}>
          {(artists ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/40">が出演</span>
        <input
          name="display_name"
          placeholder="コラボ名義(任意・例: THE SPELLBOUND × BOOM BOOM SATELLITES)"
          defaultValue={entry.display_name ?? ''}
          className={`${inputClass} max-w-[280px]`}
        />
        <input
          name="stage"
          placeholder="ステージ名(任意)"
          defaultValue={entry.stage ?? ''}
          className={`${inputClass} max-w-[160px]`}
        />
        <input
          name="venue"
          placeholder="会場(任意・複数会場フェスの場合のみ)"
          defaultValue={entry.venue ?? ''}
          className={`${inputClass} max-w-[220px]`}
        />
        <input
          name="start_time"
          type="datetime-local"
          defaultValue={toJstDatetimeLocal(entry.start_time)}
          className={`${inputClass} max-w-[200px]`}
        />
        <input
          name="end_time"
          type="datetime-local"
          defaultValue={toJstDatetimeLocal(entry.end_time)}
          className={`${inputClass} max-w-[200px]`}
        />
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input name="is_headliner" type="checkbox" defaultChecked={entry.is_headliner} className="h-3.5 w-3.5" />
          ヘッドライナー
        </label>
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <p className="text-xs uppercase tracking-wide text-white/40">
          構成アーティスト(コラボ名義の場合、この出演を構成する全員)
        </p>
        <p className="mt-1 text-xs text-white/30">
          上の「が出演」欄は代表アーティスト(検索・並び替え等の基準)。コラボ出演では、ここに実際に出演した全員を登録する。
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {collaborators.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <Link href={`/artists/${c.id}`} className="hover:underline">
                {c.name}
              </Link>
              {collaborators.length > 1 && (
                <form action={removeAppearanceArtist}>
                  <input type="hidden" name="event_appearance_id" value={entry.id} />
                  <input type="hidden" name="artist_id" value={c.id} />
                  <button type="submit" className="text-xs text-red-400/70 hover:text-red-400">
                    外す
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>

        <form action={addAppearanceArtist} className="mt-4 flex items-center gap-2">
          <input type="hidden" name="event_appearance_id" value={entry.id} />
          <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アーティストを選択...
            </option>
            {(artists ?? [])
              .filter((a) => !collaborators.some((c) => c.id === a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <button type="submit" className={buttonClass}>
            構成アーティストとして追加
          </button>
        </form>
      </div>

      <form action={deleteEventAppearance} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <input type="hidden" name="artist_id" value={entry.artist_id} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この出演情報を削除
        </button>
      </form>
    </div>
  )
}
