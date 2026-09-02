// app/admin/data/media/radio-power-play-collect/page.tsx
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import CollectButton from './CollectButton'

export default async function RadioPowerPlayCollectPage() {
  const supabase = await createClient()
  const { data: stations } = await supabase
    .from('media')
    .select('name, power_play_url')
    .eq('media_type', 'radio')
    .not('power_play_url', 'is', null)
    .order('name')

  return (
    <div className="mx-auto max-w-[900px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ラジオ局PP自動収集</h1>
      <p className="mt-2 text-sm text-white/50">
        URLが登録済みの局について、パワープレイ/ヘビーローテーションをGeminiでまとめて抽出し、
        新規に見つかった選曲を「HRPP 手動マッチング」画面の候補として登録します。ボタンは何度押しても
        安全です(今月内に既に登録済みの選曲は重複登録されません)。
      </p>

      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/30">
        対象局({stations?.length ?? 0}局)
      </p>
      <ul className="mt-2 space-y-1 text-xs text-white/50">
        {(stations ?? []).map((s) => (
          <li key={s.name}>{s.name}</li>
        ))}
        {(stations?.length ?? 0) === 0 && <li>URLが登録済みの局がまだありません。</li>}
      </ul>

      <CollectButton />

      <Link
        href="/admin/data/media/radio-fact-check"
        className="mt-6 inline-block text-xs text-white/40 hover:text-white/70"
      >
        収集結果をファクトチェックする →
      </Link>
    </div>
  )
}
