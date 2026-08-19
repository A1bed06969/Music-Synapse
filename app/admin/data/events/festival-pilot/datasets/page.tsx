import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { inputClass, buttonClass } from '../../../adminUi'
import { saveFestivalPilotDataset, deleteFestivalPilotDataset } from '../actions'

export default async function FestivalPilotDatasetsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const { data: datasets } = await supabase
    .from('festival_pilot_dataset')
    .select('id, key, label, picks, updated_at')
    .order('label')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events/festival-pilot" className="text-xs text-white/40 hover:text-white/70">
        ← 世界のフェス出演者収集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">フェス出演者データを管理</h1>
      <p className="mt-2 text-sm text-white/50">
        フェスの出演者一覧(アーティスト名・日程・ステージ・時間)をJSON配列として登録・更新する。
        既存のキーで保存すると内容が上書きされる。ここで保存したデータは
        「世界のフェス出演者収集」のタブとしてすぐに反映される(デプロイ不要)。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      <form action={saveFestivalPilotDataset} className="mt-6 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            name="key"
            placeholder="キー(半角英数・ハイフンのみ、例: sweetloveshower)"
            required
            pattern="[a-z0-9_-]+"
            className={`${inputClass} max-w-xs`}
          />
          <input name="label" placeholder="表示名(例: スイートラブシャワー)" required className={`${inputClass} max-w-xs`} />
        </div>
        <textarea
          name="picks"
          placeholder='JSON配列を貼り付け(例: [{"festivalName":"...","editionYear":2026,"stage":"...","day":"2026-08-28","artistName":"...","startDate":"2026-08-28","endDate":"2026-08-30","performanceDate":"2026-08-28","startAt":"2026-08-28T10:45:00+09:00","endAt":"2026-08-28T12:15:00+09:00"}])'
          required
          rows={10}
          className={`${inputClass} font-mono text-xs`}
        />
        <button type="submit" className={buttonClass}>
          保存(新規作成 / 既存キーなら上書き)
        </button>
      </form>

      {datasets && datasets.length > 0 && (
        <ul className="mt-8 space-y-2 text-sm text-white/60">
          {datasets.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-white/15 px-4 py-3">
              <span>
                {d.label} <span className="text-white/30">({d.key} · {Array.isArray(d.picks) ? d.picks.length : 0}件)</span>
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/admin/data/events/festival-pilot?festival=${d.key}`}
                  className="text-xs text-white/40 hover:text-white/70"
                >
                  表示 →
                </Link>
                <form action={deleteFestivalPilotDataset}>
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" className="text-xs text-red-400 hover:text-red-300">
                    削除
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
