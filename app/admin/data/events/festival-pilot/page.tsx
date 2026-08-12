import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchGlastonburyLineup, type FestivalPick } from '@/utils/festivalScrape'
import { registerFestivalAppearance } from './actions'
import SubmitButton from './SubmitButton'

export const maxDuration = 60

type MatchedPick = FestivalPick & {
  matchedArtistId: string
  matchedArtistName: string
  alreadyRegistered: boolean
}

export default async function FestivalPilotPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  let picks: FestivalPick[] = []
  let fetchError: string | null = null
  try {
    picks = await fetchGlastonburyLineup()
  } catch (err) {
    fetchError = err instanceof Error ? err.message : '取得に失敗しました。'
  }

  const { data: artists } = await supabase.from('artist').select('id, name')
  const artistByName = new Map((artists ?? []).map((a) => [a.name.trim().toUpperCase(), a]))

  const editionYear = picks[0]?.editionYear ?? null
  let registeredArtistIds = new Set<string>()
  if (editionYear) {
    const { data: existingEvent } = await supabase
      .from('event')
      .select('id')
      .eq('name', 'Glastonbury Festival')
      .maybeSingle()
    if (existingEvent) {
      const { data: existingEdition } = await supabase
        .from('event_edition')
        .select('id')
        .eq('event_id', existingEvent.id)
        .eq('year', editionYear)
        .maybeSingle()
      if (existingEdition) {
        const { data: appearances } = await supabase
          .from('event_appearance')
          .select('artist_id')
          .eq('event_edition_id', existingEdition.id)
        registeredArtistIds = new Set((appearances ?? []).map((a) => a.artist_id))
      }
    }
  }

  const matched: MatchedPick[] = []
  for (const pick of picks) {
    const artist = artistByName.get(pick.artistName.trim().toUpperCase())
    if (!artist) continue
    matched.push({
      ...pick,
      matchedArtistId: artist.id,
      matchedArtistName: artist.name,
      alreadyRegistered: registeredArtistIds.has(artist.id),
    })
  }

  const byStage = new Map<string, MatchedPick[]>()
  for (const p of matched) {
    const key = p.stage ?? '不明'
    const list = byStage.get(key) ?? []
    list.push(p)
    byStage.set(key, list)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
        ← イベント管理に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">世界のフェス出演者収集(パイロット: Glastonbury)</h1>
      <p className="mt-2 text-sm text-white/50">
        Glastonbury Festivalの公式ラインナップページから最新開催回の出演者を取得します。
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

      {picks.length > 0 && (
        <p className="mt-6 text-xs text-white/40">
          {picks[0].editionYear}年開催分を取得: 出演{picks.length}件中、カタログに一致{matched.length}件
        </p>
      )}

      {matched.length === 0 ? (
        !fetchError && <p className="mt-8 text-sm text-white/40">カタログに一致する出演者が見つかりませんでした。</p>
      ) : (
        Array.from(byStage.entries()).map(([stage, picksForStage]) => (
          <section key={stage} className="mt-8">
            <h2 className="text-sm font-semibold">{stage}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {picksForStage.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/15 px-4 py-3">
                  <div>
                    <span className="font-medium">{p.matchedArtistName}</span>
                    {p.day && (
                      <span className="ml-2 text-xs text-white/30">
                        ({p.day}
                        {p.startAt && ` ${p.startAt.slice(11, 16)}-${p.endAt?.slice(11, 16) ?? ''}`})
                      </span>
                    )}
                  </div>
                  {p.alreadyRegistered ? (
                    <span className="shrink-0 text-xs text-white/30">登録済み</span>
                  ) : (
                    <form action={registerFestivalAppearance}>
                      <input type="hidden" name="festival_name" value={p.festivalName} />
                      <input type="hidden" name="edition_year" value={p.editionYear} />
                      <input type="hidden" name="start_date" value={p.startDate ?? ''} />
                      <input type="hidden" name="end_date" value={p.endDate ?? ''} />
                      <input type="hidden" name="artist_id" value={p.matchedArtistId} />
                      <input type="hidden" name="artist_name" value={p.matchedArtistName} />
                      <input type="hidden" name="stage" value={p.stage ?? ''} />
                      <input type="hidden" name="performance_date" value={p.performanceDate ?? ''} />
                      <input type="hidden" name="start_at" value={p.startAt ?? ''} />
                      <input type="hidden" name="end_at" value={p.endAt ?? ''} />
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
