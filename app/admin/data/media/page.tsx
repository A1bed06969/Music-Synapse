import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import { inputClass, buttonClass } from '../adminUi'
import SearchableSelect from '../SearchableSelect'
import { searchTracks, searchAlbums } from '../actions'
import { createMedia, createMediaProgram, createRadioRotation } from './actions'

const MEDIA_TYPE_OPTIONS = [
  { value: 'radio', label: 'ラジオ' },
  { value: 'tv', label: 'テレビ' },
  { value: 'magazine', label: '雑誌' },
  { value: 'web', label: 'Web' },
]

const PERIOD_TYPE_OPTIONS = [
  { value: 'weekly', label: '週間' },
  { value: 'monthly', label: '月間' },
]

const MUSIC_TYPE_OPTIONS = [
  { value: 'DOMESTIC', label: '邦楽' },
  { value: 'OVERSEAS', label: '洋楽' },
]

export default async function MediaAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [{ data: artists }, { data: mediaList }, { data: mediaPrograms }, { data: rotations }] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('media').select('id, name, area').order('name'),
    supabase.from('media_program').select('id, program_name, period_type, media:media_id(name)').order('program_name'),
    supabase
      .from('radio_rotation')
      .select(
        'id, period_type, period_start_date, music_type, note, media_program:media_program_id(program_name, media:media_id(name)), track:track_id(title), album:album_id(title), artist:artist_id(name)'
      )
      .order('period_start_date', { ascending: false }),
  ])

  const artistOptions = artists ?? []
  const mediaOptions = mediaList ?? []
  const mediaProgramOptions = mediaPrograms ?? []

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">メディア&オンエア</h1>
        <div className="flex gap-3">
          <Link href="/admin/data/media/radio-pilot" className="text-xs text-white/40 hover:text-white/70">
            ラジオ局PP収集(パイロット) →
          </Link>
          <Link href="/media/on-air" className="text-xs text-white/40 hover:text-white/70">
            公開ページを見る →
          </Link>
        </div>
      </div>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={createMedia} className="mt-6 flex flex-wrap gap-2">
        <input name="name" placeholder="メディア名(例: FM802)" required className={`${inputClass} max-w-xs`} />
        <select name="media_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
          <option value="">種別(任意)</option>
          {MEDIA_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input name="area" placeholder="エリア(任意。例: 関西)" className={`${inputClass} max-w-[160px]`} />
        <select name="prefecture" className={`${inputClass} max-w-[140px]`} defaultValue="">
          <option value="">都道府県(任意)</option>
          {PREFECTURE_COORDS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass}>
          メディアを追加
        </button>
      </form>

      <form action={createMediaProgram} className="mt-4 flex flex-wrap gap-2">
        <select name="media_id" required className={`${inputClass} max-w-xs`} defaultValue="">
          <option value="" disabled>
            メディアを選択
          </option>
          {mediaOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.area ? `(${m.area})` : ''}
            </option>
          ))}
        </select>
        <input name="program_name" placeholder="番組・企画名(例: ヘビーローテーション)" required className={`${inputClass} max-w-xs`} />
        <select name="period_type" required className={`${inputClass} max-w-[140px]`} defaultValue="">
          <option value="" disabled>
            集計周期
          </option>
          {PERIOD_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass}>
          番組を追加
        </button>
      </form>

      <p className="mt-6 text-xs text-white/40">
        プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。
      </p>
      <form action={createRadioRotation} className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select name="media_program_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              番組を選択
            </option>
            {mediaProgramOptions.map((p) => {
              const media = Array.isArray(p.media) ? p.media[0] : p.media
              return (
                <option key={p.id} value={p.id}>
                  {media?.name} — {p.program_name}
                </option>
              )
            })}
          </select>
          <select name="period_type" required className={`${inputClass} max-w-[120px]`} defaultValue="">
            <option value="" disabled>
              周期
            </option>
            {PERIOD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input name="period_start_date" type="date" required className={`${inputClass} max-w-[160px]`} />
          <select name="music_type" required className={`${inputClass} max-w-[120px]`} defaultValue="">
            <option value="" disabled>
              邦楽/洋楽
            </option>
            {MUSIC_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchableSelect searchAction={searchTracks} name="track_id" placeholder="トラックを検索(任意)" />
          <SearchableSelect searchAction={searchAlbums} name="album_id" placeholder="アルバムを検索(任意)" />
          <select name="artist_id" className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="">(アーティスト指定なし)</option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <input name="note" placeholder="メモ(任意)" className={inputClass} />
        <button type="submit" className={buttonClass}>
          オンエアデータを追加
        </button>
      </form>

      {rotations && rotations.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-white/60">
          {rotations.map((row) => {
            const program = Array.isArray(row.media_program) ? row.media_program[0] : row.media_program
            const media = program ? (Array.isArray(program.media) ? program.media[0] : program.media) : null
            const track = Array.isArray(row.track) ? row.track[0] : row.track
            const album = Array.isArray(row.album) ? row.album[0] : row.album
            const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
            const target = track?.title ?? album?.title ?? artist?.name
            return (
              <li key={row.id}>
                {row.period_start_date} {media?.name} {program?.program_name} — {target}
                <span className="text-white/30"> ({row.music_type === 'DOMESTIC' ? '邦楽' : '洋楽'})</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
