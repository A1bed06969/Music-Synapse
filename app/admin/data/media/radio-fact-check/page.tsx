// app/admin/data/media/radio-fact-check/page.tsx
//
// Gemini自動抽出(app/api/admin/radio-power-play-collect)の結果が実際に各局の
// サイトの内容と合っているかを、人力で目視確認するための一覧。この確認は
// Apple Music候補のマッチング(radio-airplay-pickページ)より前段の、抽出精度
// そのものの検証(このセッション中に何度も見つかったフィールド入れ替わり・
// アーカイブ誤抽出などのバグの再発を早期に見つける狙い)。
import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import FactCheckRow from './FactCheckRow'
import AddPickRow from './AddPickRow'
import { markFactCheckCorrect, saveFactCheckCorrection, addManualPick } from './actions'

type PickRow = {
  id: string
  region: string
  station_name: string
  artist_name: string | null
  track_title: string | null
  fact_checked_correct: boolean | null
}

function toMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

function currentMonthKeyJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7)
}

export default async function RadioFactCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const supabase = await createClient()

  const [{ data: dateRows }, { data: stations }] = await Promise.all([
    supabase
      .from('radio_airplay_pick')
      .select('picked_date')
      .not('artist_name', 'is', null)
      .not('track_title', 'is', null)
      .order('picked_date', { ascending: false })
      .limit(5000),
    supabase.from('media').select('name, area, prefecture').eq('media_type', 'radio').order('name'),
  ])

  const months = Array.from(new Set([currentMonthKeyJST(), ...(dateRows ?? []).map((r) => toMonthKey(r.picked_date))])).sort(
    (a, b) => (a < b ? 1 : -1)
  )
  const selectedMonth = month && months.includes(month) ? month : (months[0] ?? '')

  const { data: picks } = selectedMonth
    ? await supabase
        .from('radio_airplay_pick')
        .select('id, region, station_name, artist_name, track_title, fact_checked_correct')
        .not('artist_name', 'is', null)
        .not('track_title', 'is', null)
        .gte('picked_date', `${selectedMonth}-01`)
        .lt('picked_date', `${nextMonthKey(selectedMonth)}-01`)
    : { data: [] as PickRow[] }

  const picksByStation = new Map<string, PickRow[]>()
  for (const p of (picks ?? []) as PickRow[]) {
    const arr = picksByStation.get(p.station_name) ?? []
    arr.push(p)
    picksByStation.set(p.station_name, arr)
  }

  // 局の全体集合はmediaテーブルのラジオ局全件を基準にする(自動収集URL未登録の
  // 手動専用局も含めて、抽出0件の局を見落とさず一覧に出すため)。
  const grouped: { region: string; stations: { stationName: string; picks: PickRow[] }[] }[] = []
  for (const m of stations ?? []) {
    const region = m.area ?? m.prefecture ?? '不明'
    let regionGroup = grouped.find((g) => g.region === region)
    if (!regionGroup) {
      regionGroup = { region, stations: [] }
      grouped.push(regionGroup)
    }
    regionGroup.stations.push({ stationName: m.name, picks: picksByStation.get(m.name) ?? [] })
  }
  grouped.sort((a, b) => a.region.localeCompare(b.region, 'ja'))
  for (const g of grouped) {
    g.stations.sort((a, b) => a.stationName.localeCompare(b.stationName, 'ja'))
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-12">
      <Link href="/admin/data/media" className="text-xs text-white/40 hover:text-white/70">
        ← メディア&オンエアに戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ラジオPP ファクトチェック</h1>
      <p className="mt-2 text-sm text-white/50">
        自動抽出されたアーティスト名・曲名が各局サイトの実際の内容と合っているか確認してください。
        正しければTRUEにチェック、間違っていればFALSEにチェックしてその場で正しい値に修正・保存できます
        (修正後の値はマッチング・登録フローでもそのまま使われます)。登録済みの全ラジオ局を表示するので、
        「未抽出」の局は局サイトを直接確認して「+ 手動で追加」から選曲を登録してください。
      </p>

      <form className="mt-4 flex items-center gap-2" action="">
        <select
          name="month"
          defaultValue={selectedMonth}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {months.length === 0 && <option value="">データなし</option>}
        </select>
        <button type="submit" className="rounded-md border border-white/15 px-3 py-2 text-xs text-white/60 hover:text-white">
          表示
        </button>
      </form>

      <div className="mt-8 space-y-8">
        {grouped.map((g) => (
          <section key={g.region}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">{g.region}</h2>
            <div className="mt-3 space-y-4">
              {g.stations.map((s) => (
                <div key={s.stationName}>
                  <p className={`text-xs ${s.picks.length === 0 ? 'text-amber-400/70' : 'text-white/50'}`}>
                    {s.stationName}(曲数: {s.picks.length}
                    {s.picks.length === 0 && ' — 未抽出'})
                  </p>
                  <ul className="mt-1 space-y-2">
                    {s.picks.map((p) => (
                      <FactCheckRow
                        key={p.id}
                        pickId={p.id}
                        artistName={p.artist_name ?? ''}
                        trackTitle={p.track_title ?? ''}
                        factCheckedCorrect={p.fact_checked_correct}
                        markCorrectAction={markFactCheckCorrect}
                        saveCorrectionAction={saveFactCheckCorrection}
                      />
                    ))}
                  </ul>
                  <AddPickRow stationName={s.stationName} region={g.region} monthKey={selectedMonth} addAction={addManualPick} />
                </div>
              ))}
            </div>
          </section>
        ))}
        {grouped.length === 0 && <p className="text-xs text-white/30">ラジオ局が登録されていません。</p>}
      </div>
    </div>
  )
}
