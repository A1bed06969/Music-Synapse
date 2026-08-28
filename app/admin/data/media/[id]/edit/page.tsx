import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import { inputClass, buttonClass } from '../../../adminUi'
import { updateMedia, deleteMedia } from '../../actions'

const MEDIA_TYPE_OPTIONS = [
  { value: 'radio', label: 'ラジオ' },
  { value: 'tv', label: 'テレビ' },
  { value: 'magazine', label: '雑誌' },
  { value: 'web', label: 'Web' },
]

export default async function EditMediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: media, error } = await supabase
    .from('media')
    .select('id, name, media_type, area, prefecture, logo_url')
    .eq('id', id)
    .single()

  if (error || !media) {
    notFound()
  }

  const { count: programCount } = await supabase
    .from('media_program')
    .select('id', { count: 'exact', head: true })
    .eq('media_id', id)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ラジオ局情報を編集</h1>

      <form action={updateMedia} className="mt-6 flex max-w-xl flex-col gap-2">
        <input type="hidden" name="id" value={media.id} />
        <input name="name" defaultValue={media.name} placeholder="メディア名(例: FM802)" required className={inputClass} />
        <select name="media_type" defaultValue={media.media_type ?? ''} className={inputClass}>
          <option value="">種別(任意)</option>
          {MEDIA_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input name="area" defaultValue={media.area ?? ''} placeholder="エリア(任意。例: 関西、全国)" className={inputClass} />
        <select name="prefecture" defaultValue={media.prefecture ?? ''} className={inputClass}>
          <option value="">都道府県(任意)</option>
          {PREFECTURE_COORDS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <input name="logo_url" defaultValue={media.logo_url ?? ''} placeholder="ロゴ画像URL(任意)" className={inputClass} />
        <button type="submit" className={`${buttonClass} self-start`}>
          更新する
        </button>
      </form>

      <div className="mt-8 max-w-xl border-t border-white/10 pt-6">
        {(programCount ?? 0) > 0 ? (
          <p className="text-xs text-white/40">
            番組・オンエア実績が{programCount}件紐づいているため削除できません。重複統合する場合は、先に番組を目的の局へ付け替えてください。
          </p>
        ) : (
          <form action={deleteMedia}>
            <input type="hidden" name="id" value={media.id} />
            <button
              type="submit"
              className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
            >
              このメディアを削除(重複整理用)
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
