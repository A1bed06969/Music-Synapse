import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { fetchAllRows } from '@/utils/fetchAllRows'
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

export default async function FestivalPilotPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; festival?: string }>
}) {
  const { success, error: errorMessage, festival: festivalParam } = await searchParams
  const supabase = await createClient()

  // Glastonburyだけはライブスクレイピング(utils/festivalScrape.ts)、それ以外は
  // 管理画面(festival-pilot/datasets)からDBに登録された出演者データを使う
  const { data: datasetRows } = await supabase
    .from('festival_pilot_dataset')
    .select('key, label, picks')
    .order('label')

  const FESTIVALS = [
    { key: 'glastonbury', label: 'Glastonbury', picks: null as StaticFestivalPick[] | null },
    ...(datasetRows ?? []).map((d) => ({ key: d.key, label: d.label, picks: d.picks as StaticFestivalPick[] })),
  ]
  const activeFestival = FESTIVALS.find((f) => f.key === festivalParam) ?? FESTIVALS[0]

  let picks: StaticFestivalPick[] = []
  let fetchError: string | null = null
  try {
    picks = activeFestival.picks ?? (await fetchGlastonburyLineup())
  } catch (err) {
    fetchError = err instanceof Error ? err.message : '取得に失敗しました。'
  }

  // artistは2933件でPostgRESTの上限(1000件)を超えており、単純な.select()だと
  // 後半に登録されたアーティストが既存一致判定から漏れ、実際にはカタログに
  // いるのに毎回「未一致」として表示されてしまう
  const [artists, { data: artistLinks }] = await Promise.all([
    fetchAllRows<{ id: string; name: string }>(supabase, 'artist', 'id, name', 'id'),
    supabase
      .from('festival_pilot_artist_link')
      .select('pick_name, artist:artist_id(id, name)')
      .eq('dataset_key', activeFestival.key),
  ])
  const artistByName = new Map(artists.map((a) => [a.name.trim().toUpperCase(), a]))
  // iTunes側の名前がローカライズされてフェス側の表記と一致しなくなった場合の
  // 救済(例: "ALANIS MORISSETTE" → "アラニス・モリセット")。一度でも登録できた
  // pick_nameは、以後は表記の完全一致に頼らずこちらを優先する
  const artistByLinkedPickName = new Map(
    (artistLinks ?? [])
      .map((r) => {
        const artist = Array.isArray(r.artist) ? r.artist[0] : r.artist
        return artist ? ([r.pick_name, artist] as const) : null
      })
      .filter((r): r is readonly [string, { id: string; name: string }] => r !== null)
  )

  const festivalName = picks[0]?.festivalName ?? null
  const editionYear = picks[0]?.editionYear ?? null
  let registeredArtistIds = new Set<string>()
  if (festivalName && editionYear) {
    const { data: existingEvent } = await supabase
      .from('event')
      .select('id')
      .ilike('name', festivalName.trim())
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
    const normalizedName = pick.artistName.trim().toUpperCase()
    const artist = artistByLinkedPickName.get(normalizedName) ?? artistByName.get(normalizedName)
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
      <div className="flex items-center justify-between">
        <Link href="/admin/data/events" className="text-xs text-white/40 hover:text-white/70">
          ← イベント管理に戻る
        </Link>
        <Link href="/admin/data/events/festival-pilot/datasets" className="text-xs text-white/40 hover:text-white/70">
          出演者データを管理 →
        </Link>
      </div>

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
                    {matchedRows.map((p) => (
                      <li
                        key={p.artistName}
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
                            <input type="hidden" name="dataset_key" value={activeFestival.key} />
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
                            <input type="hidden" name="region" value={p.region ?? ''} />
                            <SubmitButton />
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {unmatchedRows.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-start gap-1.5">
                    {unmatchedRows.map((p) => (
                      <UnmatchedArtistTag
                        key={p.artistName}
                        pick={{
                          artistName: p.artistName,
                          datasetKey: activeFestival.key,
                          festivalName: p.festivalName,
                          editionYear: p.editionYear,
                          startDate: p.startDate,
                          endDate: p.endDate,
                          stage: p.stage,
                          performanceDate: p.performanceDate,
                          startAt: p.startAt,
                          endAt: p.endAt,
                          day: p.day,
                          region: p.region,
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
