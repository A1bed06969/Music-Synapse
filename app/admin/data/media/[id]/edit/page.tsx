import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import { inputClass, buttonClass } from '../../../adminUi'
import { updateMedia } from '../../actions'

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
        <input name="area" defaultValue={media.area ?? ''} placeholder="エリア(任意。例: 関西)" className={inputClass} />
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
    </div>
  )
}
