import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../../adminUi'
import { updateSyncWork } from '../../../actions'

const WORK_TYPE_OPTIONS = [
  { value: 'cm', label: 'CM' },
  { value: 'anime', label: 'アニメ' },
  { value: 'game', label: 'ゲーム' },
  { value: 'movie', label: '映画' },
  { value: 'tv_program', label: 'テレビ番組' },
]

export default async function EditSyncWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: work, error } = await supabase
    .from('sync_work')
    .select('id, title, work_type, company_or_studio, year')
    .eq('id', id)
    .single()

  if (error || !work) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/sync" className="text-xs text-white/40 hover:text-white/70">
        ← タイアップ一覧に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">作品を編集</h1>

      <form action={updateSyncWork} className="mt-6 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={work.id} />
        <input
          name="title"
          placeholder="作品名(例: 熱闘甲子園)"
          required
          defaultValue={work.title}
          className={`${inputClass} max-w-xs`}
        />
        <select name="work_type" className={`${inputClass} max-w-[140px]`} defaultValue={work.work_type ?? ''}>
          <option value="">起用種別(任意)</option>
          {WORK_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          name="company_or_studio"
          placeholder="企業・制作会社(任意)"
          defaultValue={work.company_or_studio ?? ''}
          className={`${inputClass} max-w-xs`}
        />
        <input
          name="year"
          type="number"
          placeholder="年(任意)"
          defaultValue={work.year ?? ''}
          className={`${inputClass} max-w-[120px]`}
        />
        <button type="submit" className={buttonClass}>
          更新する
        </button>
      </form>
    </div>
  )
}
