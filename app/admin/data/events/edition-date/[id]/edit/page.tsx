import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import { updateEventEditionDate, deleteEventEditionDate } from '../../../actions'

export default async function EditEventEditionDatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: eventEditions }] = await Promise.all([
    supabase.from('event_edition_date').select('id, event_edition_id, date, venue, region').eq('id', id).single(),
    supabase.from('event_edition').select('id, year, event:event_id(name)').order('year', { ascending: false }),
  ])

  if (error || !entry) {
    notFound()
  }

  const eventEditionOptions = (eventEditions ?? []).map((row) => {
    const event = Array.isArray(row.event) ? row.event[0] : row.event
    return { id: row.id, label: `${event?.name ?? '?'}(${row.year})` }
  })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">開催日程・会場を編集</h1>

      <form action={updateEventEditionDate} className="mt-6 flex flex-wrap gap-2">
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
        <input name="date" type="date" required defaultValue={entry.date} className={`${inputClass} max-w-[160px]`} />
        <input
          name="venue"
          placeholder="会場(例: 幕張メッセ)"
          required
          defaultValue={entry.venue}
          className={`${inputClass} max-w-xs`}
        />
        <input
          name="region"
          placeholder="都市(任意・例: 東京)"
          defaultValue={entry.region ?? ''}
          className={`${inputClass} max-w-[140px]`}
        />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteEventEditionDate} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この開催日程を削除
        </button>
      </form>
    </div>
  )
}
