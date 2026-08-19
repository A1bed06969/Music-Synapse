import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import { updateEvent, deleteEvent } from '../../../actions'

const EVENT_TYPE_OPTIONS = [
  { value: 'festival', label: 'フェス' },
  { value: 'one_off_live', label: '単発イベント' },
  { value: 'tour', label: 'ツアー' },
  { value: 'other', label: 'その他' },
]

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: entry, error }, { data: genres }] = await Promise.all([
    supabase
      .from('event')
      .select(
        'id, name, name_ja, event_type, founded_year, country, prefecture, description, genre_id, image_url, official_site_url, official_youtube_url'
      )
      .eq('id', id)
      .single(),
    supabase.from('genre').select('id, name').order('name'),
  ])

  if (error || !entry) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">イベントを編集</h1>

      <form action={updateEvent} className="mt-6 space-y-2">
        <input type="hidden" name="id" value={entry.id} />
        <div className="flex flex-wrap gap-2">
          <input
            name="name"
            placeholder="イベント名(例: FUJI ROCK FESTIVAL)"
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
          更新する
        </button>
      </form>

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
