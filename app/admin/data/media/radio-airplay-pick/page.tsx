import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import RadioPickMatcher from './RadioPickMatcher'

export default async function RadioAirplayPickAdminPage() {
  const supabase = await createClient()

  const { data: picks } = await supabase
    .from('radio_airplay_pick')
    .select('id, region, station_name, campaign_name, picked_date, artist_name, track_title')
    .is('candidate_track_id', null)
    .not('artist_name', 'is', null)
    .not('track_title', 'is', null)
    .order('picked_date', { ascending: false })

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">HRPP 手動マッチング</h1>
      <p className="mt-2 text-sm text-white/50">
        自動マッチング(scripts/backfill-radio-pick-itunes-candidates.ts)で候補が見つからなかった{picks?.length ?? 0}件を、
        Apple Musicカタログから手動で検索して候補を設定できます。あくまで候補としての保存であり、artist/track本体への自動登録は行いません。
      </p>

      <ul className="mt-8 space-y-2">
        {(picks ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {p.artist_name} — {p.track_title}
              </p>
              <p className="truncate text-xs text-white/40">
                {p.station_name}
                {p.campaign_name ? `(${p.campaign_name})` : ''} / {p.picked_date}
              </p>
            </div>
            <div className="w-full max-w-xs shrink-0">
              <RadioPickMatcher pickId={p.id} />
            </div>
          </li>
        ))}
        {(picks ?? []).length === 0 && (
          <p className="text-xs text-white/30">未マッチの候補はありません。</p>
        )}
      </ul>
    </div>
  )
}
