import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchPilotRadioPicks, type RadioPick } from '@/utils/radioScrape'
import { registerRadioPick } from './actions'
import SubmitButton from './SubmitButton'

export const maxDuration = 60

type MatchedPick = RadioPick & {
  matchedArtistId: string | null
  matchedTrackId: string | null
}

export default async function RadioPilotPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  let picks: RadioPick[] = []
  let fetchError: string | null = null
  try {
    picks = await fetchPilotRadioPicks()
  } catch (err) {
    fetchError = err instanceof Error ? err.message : '取得に失敗しました。'
  }

  const matched: MatchedPick[] = []
  for (const pick of picks) {
    const { data: artist } = await supabase
      .from('artist')
      .select('id')
      .ilike('name', pick.artistName)
      .maybeSingle()

    let matchedTrackId: string | null = null
    if (artist) {
      const { data: track } = await supabase
        .from('track')
        .select('id')
        .eq('artist_id', artist.id)
        .ilike('title', pick.trackTitle)
        .maybeSingle()
      matchedTrackId = track?.id ?? null
    }

    matched.push({ ...pick, matchedArtistId: artist?.id ?? null, matchedTrackId })
  }

  const byStation = new Map<string, MatchedPick[]>()
  for (const p of matched) {
    const list = byStation.get(p.stationName) ?? []
    list.push(p)
    byStation.set(p.stationName, list)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ラジオ局PP収集(パイロット)</h1>
      <p className="mt-2 text-sm text-white/50">
        J-WAVE・FM福井・FMノースウェーブの最新パワープレイ/ヘビーローテーションを取得します。
        カタログの既存アーティストと一致した場合のみ登録できます(新規アーティストは自動登録しません)。
      </p>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}
      {fetchError && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{fetchError}</div>
      )}

      {matched.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">取得できた選曲がありません。</p>
      ) : (
        Array.from(byStation.entries()).map(([station, picksForStation]) => (
          <section key={station} className="mt-8">
            <h2 className="text-sm font-semibold">{station}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {picksForStation.map((p, i) => (
                <li key={i} className="rounded-md border border-white/15 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{p.artistName}</span>
                      <span className="text-white/40"> — {p.trackTitle}</span>
                      <span className="ml-2 text-xs text-white/30">({p.programName})</span>
                    </div>
                    {p.matchedArtistId ? (
                      <span className="shrink-0 text-xs text-emerald-400">
                        カタログに一致{p.matchedTrackId ? '(曲も一致)' : ''}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-white/30">カタログに無し</span>
                    )}
                  </div>
                  {p.matchedArtistId && p.periodStartDate && (
                    <form action={registerRadioPick} className="mt-2 flex items-center gap-2">
                      <input type="hidden" name="station_name" value={p.stationName} />
                      <input type="hidden" name="program_name" value={p.programName} />
                      <input type="hidden" name="period_start_date" value={p.periodStartDate} />
                      <input type="hidden" name="artist_id" value={p.matchedArtistId} />
                      <input type="hidden" name="track_id" value={p.matchedTrackId ?? ''} />
                      <input type="hidden" name="note" value={`${p.artistName}／${p.trackTitle}`} />
                      <select
                        name="music_type"
                        defaultValue="DOMESTIC"
                        className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white focus:border-white/30 focus:outline-none"
                      >
                        <option value="DOMESTIC">邦楽</option>
                        <option value="OVERSEAS">洋楽</option>
                      </select>
                      <SubmitButton />
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
