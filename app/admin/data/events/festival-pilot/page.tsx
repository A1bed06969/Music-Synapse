import Link from 'next/link'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/utils/Supabase/server'
import { fetchGlastonburyLineup, type FestivalPick } from '@/utils/festivalScrape'
import { registerFestivalAppearance } from './actions'
import SubmitButton from './SubmitButton'
import UnmatchedArtistTag from './UnmatchedArtistTag'

export const maxDuration = 60

type StaticFestivalPick = FestivalPick & { suspicious?: boolean }
type DisplayPick = StaticFestivalPick & {
  matchedArtistId: string | null
  matchedArtistName: string | null
  alreadyRegistered: boolean
}

const FESTIVALS = [
  { key: 'glastonbury', label: 'Glastonbury', dataFile: null },
  { key: 'fujirock', label: 'フジロック', dataFile: 'fujirock-2026.json' },
  { key: 'summersonic', label: 'サマーソニック', dataFile: 'summersonic-2026.json' },
  { key: 'risingsun', label: 'ライジングサン', dataFile: 'risingsun-2026.json' },
  { key: 'sweetloveshower', label: 'スイートラブシャワー', dataFile: 'sweetloveshower-2026.json' },
  { key: 'kyotoongakuhaku', label: '京都音楽博覧会', dataFile: 'kyotoongakuhaku-2026.json' },
] as const

function loadStaticPicks(dataFile: string): FestivalPick[] {
  const filePath = path.join(process.cwd(), 'app/admin/data/events/festival-pilot/data', dataFile)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

export default async function FestivalPilotPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; festival?: string }>
}) {
  const { success, error: errorMessage, festival: festivalParam } = await searchParams
  const activeFestival = FESTIVALS.find((f) => f.key === festivalParam) ?? FESTIVALS[0]
  const supabase = await createClient()

  let picks: StaticFestivalPick[] = []
  let fetchError: string | null = null
  try {
    picks = activeFestival.dataFile ? loadStaticPicks(activeFestival.dataFile) : await fetchGlastonburyLineup()
  } catch (err) {
    fetchError = err instanceof Error ? err.message : '取得に失敗しました。'
  }

  const { data: artists } = await supabase.from('artist').select('id, name')
  const artistByName = new Map((artists ?? []).map((a) => [a.name.trim().toUpperCase(), a]))

  const festivalName = picks[0]?.festivalName ?? null
  const editionYear = picks[0]?.editionYear ?? null
  let registeredArtistIds = new Set<string>()
  if (festivalName && editionYear) {
    const { data: existingEvent } = await supabase
      .from('event')
      .select('id')
      .eq('name', festivalName)
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

  const displayPicks: DisplayPick[] = picks.map((pick) => {
    const artist = artistByName.get(pick.artistName.trim().toUpperCase())
    return {
      ...pick,
      matchedArtistId: artist?.id ?? null,
      matchedArtistName: artist?.name ?? null,
      alreadyRegistered: artist ? registeredArtistIds.has(artist.id) : false,
    }
  })
  const matchedCount = displayPicks.filter((p) => p.matchedArtistId).length

  const byStage = new Map<string, DisplayPick[]>()
  for (const p of displayPicks) {
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

      <h1 className="mt-4 text-2xl font-bold">世界のフェス出演者収集</h1>
      <p className="mt-2 text-sm text-white/50">
        カタログに既にいるアーティストはそのまま登録できます。薄く表示されている未一致のアーティストは、
        クリックするとApple Musicを検索して候補を表示します。人物が合っていれば「この人で登録」でカタログへの取込と出演登録を同時に行います(自動では確定しません)。
        <span className="text-amber-400">⚠</span>
        が付いているものは一回限りのコラボ企画・セッション名などアーティスト本体ではない可能性がある表記です。判断のうえ選んでください。
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {FESTIVALS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/data/events/festival-pilot?festival=${f.key}`}
            className={`rounded-md border px-3 py-1.5 text-xs transition ${
              f.key === activeFestival.key
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-white/15 text-white/50 hover:border-white/30 hover:text-white/80'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

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
          {picks[0].festivalName} {picks[0].editionYear}年開催分: 出演{picks.length}件中、カタログに一致{matchedCount}件
          (一致しなかった{picks.length - matchedCount}件も下に薄く表示しています)
        </p>
      )}

      {picks.length === 0
        ? !fetchError && <p className="mt-8 text-sm text-white/40">出演者情報が取得できませんでした。</p>
        : Array.from(byStage.entries()).map(([stage, picksForStage]) => {
            const matchedRows = picksForStage.filter((p) => p.matchedArtistId)
            const unmatchedRows = picksForStage
              .filter((p) => !p.matchedArtistId)
              .sort((a, b) => Number(a.suspicious ?? false) - Number(b.suspicious ?? false))
            return (
              <section key={stage} className="mt-8">
                <h2 className="text-sm font-semibold">
                  {stage} <span className="font-normal text-white/30">({picksForStage.length}件)</span>
                </h2>

                {matchedRows.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {matchedRows.map((p, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/15 px-4 py-3"
                      >
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
                            <input type="hidden" name="artist_id" value={p.matchedArtistId!} />
                            <input type="hidden" name="artist_name" value={p.matchedArtistName!} />
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
                )}

                {unmatchedRows.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-start gap-1.5">
                    {unmatchedRows.map((p, i) => (
                      <UnmatchedArtistTag
                        key={i}
                        pick={{
                          artistName: p.artistName,
                          festivalName: p.festivalName,
                          editionYear: p.editionYear,
                          startDate: p.startDate,
                          endDate: p.endDate,
                          stage: p.stage,
                          performanceDate: p.performanceDate,
                          startAt: p.startAt,
                          endAt: p.endAt,
                          day: p.day,
                          suspicious: p.suspicious,
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
    </div>
  )
}
