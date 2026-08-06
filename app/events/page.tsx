import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

const EVENT_TYPE_LABEL: Record<string, string> = {
  festival: 'フェス',
  one_off_live: '単発イベント',
  other: 'その他',
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ event_type?: string }>
}) {
  const { event_type: eventType } = await searchParams
  const supabase = await createClient()

  let query = supabase.from('event').select('id, name, event_type, founded_year').order('name')

  if (eventType) query = query.eq('event_type', eventType)

  const { data: events } = await query

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">イベント</h1>
      <p className="mt-2 text-sm text-white/50">フェス・単発イベントの開催情報。</p>

      <form className="mt-6 flex flex-wrap gap-2" action="/events">
        <select
          name="event_type"
          defaultValue={eventType ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">種別: すべて</option>
          {Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          絞り込み
        </button>
      </form>

      {!events || events.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するイベントが登録されていません。</p>
      ) : (
        <ul className="mt-8 divide-y divide-white/10">
          {events.map((e) => (
            <li key={e.id} className="py-3">
              <Link href={`/events/${e.id}`} className="font-medium hover:opacity-70">
                {e.name}
              </Link>
              <p className="mt-0.5 text-xs text-white/40">
                {e.event_type ? EVENT_TYPE_LABEL[e.event_type] ?? e.event_type : ''}
                {e.founded_year ? ` · ${e.founded_year}年〜` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
