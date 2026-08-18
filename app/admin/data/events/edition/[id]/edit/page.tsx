import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import { updateEventEdition, deleteEventEdition } from '../../../actions'

export default async function EditEventEditionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: events }] = await Promise.all([
    supabase
      .from('event_edition')
      .select('id, event_id, year, start_date, end_date, venue, description')
      .eq('id', id)
      .single(),
    supabase.from('event').select('id, name').order('name'),
  ])

  if (error || !entry) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">開催回を編集</h1>

      <form action={updateEventEdition} className="mt-6 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={entry.id} />
        <select name="event_id" required className={`${inputClass} max-w-xs`} defaultValue={entry.event_id}>
          {(events ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input name="year" type="number" defaultValue={entry.year} required className={`${inputClass} max-w-[100px]`} />
        <input
          name="start_date"
          type="date"
          defaultValue={entry.start_date ?? ''}
          className={`${inputClass} max-w-[160px]`}
        />
        <input name="end_date" type="date" defaultValue={entry.end_date ?? ''} className={`${inputClass} max-w-[160px]`} />
        <input name="venue" placeholder="会場(任意)" defaultValue={entry.venue ?? ''} className={`${inputClass} max-w-xs`} />
        <input
          name="description"
          placeholder="概要(任意)"
          defaultValue={entry.description ?? ''}
          className={inputClass}
        />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>

      <form action={deleteEventEdition} className="mt-6">
        <input type="hidden" name="id" value={entry.id} />
        <button
          type="submit"
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
        >
          この開催回を削除(紐づく開催日程・出演情報も削除されます)
        </button>
      </form>
    </div>
  )
}
