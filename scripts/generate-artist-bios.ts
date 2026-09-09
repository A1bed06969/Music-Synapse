// scripts/generate-artist-bios.ts
//
// 選出・表彰(ranking_entry)を持つアーティストのうち、bioが空欄のものに対して
// Gemini自動生成パイプラインを実行する。優先順位は選出・表彰の件数が多い順。
// ソースはranking_article_context→Wikidata経由Wikipediaのリード文の順で解決し、
// どちらも取得できないアーティストは今回はスキップする
// (docs/superpowers/specs/2026-09-09-artist-bio-generation-design.md参照)。
//
// after()を使う後続処理(MusicBrainzインポート等)が無いため、
// scripts/verify-radio-pick-matches.tsと違いHTTP経由にせず、このスクリプトから
// 直接Supabaseを操作する。revalidatePathのみsafeRevalidatePathで包む。
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/generate-artist-bios.ts [--limit=N]
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchAllRows } from '@/utils/fetchAllRows'
import { fetchWikipediaSitelink } from '@/utils/wikidata'
import { fetchWikipediaLeadText } from '@/utils/wikipediaArticle'
import { generateArtistBioWithGemini, type BioGenerationFacts } from '@/utils/geminiBioGenerate'
import { safeRevalidatePath } from '@/utils/safeRevalidate'

type AdminClient = ReturnType<typeof createAdminClient>

const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined

type ArtistRow = {
  id: string
  name: string
  bio: string | null
  biography_status: string | null
  formed_year: number | null
  origin_prefecture: string | null
  hometown_city: string | null
}

type RankingEntryRow = {
  artist_id: string | null
  album_id: string | null
  track_id: string | null
  ranking_id: string | null
  period_date: string | null
}

export type RankingRef = { rankingId: string; year: number | null }

type PriorityResult = { priorityIds: string[]; rankingRefsByArtist: Map<string, RankingRef[]> }

/** 選出・表彰(ranking_entry)を持つアーティストIDを、件数の多い順に並べて返す。
 * ranking_entryはartist_id直付け・album_id経由・track_id経由の3パターンが
 * 混在するため、album/trackのartist_idをまとめて引いてから件数を数える。
 * 併せて、各アーティストがどのranking_id/year(period_dateの西暦4桁)に
 * 登場したかも集めて返す(resolveSourceのranking_article_contextスコープ
 * 絞り込みに使う。同一名義でも別企画・別記事の紹介文を誤って拾わないため)。 */
async function buildPriorityIds(supabase: AdminClient): Promise<PriorityResult> {
  const entries = await fetchAllRows<RankingEntryRow>(
    supabase,
    'ranking_entry',
    'artist_id, album_id, track_id, ranking_id, period_date',
    'id'
  )

  const albumIds = [...new Set(entries.map((r) => r.album_id).filter((v): v is string => v !== null))]
  const albumArtistById = new Map<string, string>()
  for (let i = 0; i < albumIds.length; i += 500) {
    const { data } = await supabase.from('album').select('id, artist_id').in('id', albumIds.slice(i, i + 500))
    for (const row of data ?? []) {
      if (row.artist_id) albumArtistById.set(row.id, row.artist_id)
    }
  }

  const trackIds = [...new Set(entries.map((r) => r.track_id).filter((v): v is string => v !== null))]
  const trackArtistById = new Map<string, string>()
  for (let i = 0; i < trackIds.length; i += 500) {
    const { data } = await supabase.from('track').select('id, artist_id').in('id', trackIds.slice(i, i + 500))
    for (const row of data ?? []) {
      if (row.artist_id) trackArtistById.set(row.id, row.artist_id)
    }
  }

  const countByArtist = new Map<string, number>()
  const rankingRefsByArtist = new Map<string, RankingRef[]>()
  for (const entry of entries) {
    const artistId =
      entry.artist_id ??
      (entry.album_id ? albumArtistById.get(entry.album_id) : undefined) ??
      (entry.track_id ? trackArtistById.get(entry.track_id) : undefined)
    if (!artistId) continue
    countByArtist.set(artistId, (countByArtist.get(artistId) ?? 0) + 1)

    if (entry.ranking_id) {
      // 同一アーティストが同じranking_id/yearに複数行(トラック単位等)で
      // 登場することがあるため、resolveSource側での重複クエリを避けるべく
      // ここで重複排除しておく。
      const year = entry.period_date ? Number(String(entry.period_date).slice(0, 4)) : null
      const refs = rankingRefsByArtist.get(artistId) ?? []
      if (!refs.some((r) => r.rankingId === entry.ranking_id && r.year === year)) {
        refs.push({ rankingId: entry.ranking_id, year })
      }
      rankingRefsByArtist.set(artistId, refs)
    }
  }

  const priorityIds = [...countByArtist.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  return { priorityIds, rankingRefsByArtist }
}

function extractQid(wikidataUrl: string): string | null {
  const match = wikidataUrl.match(/\/wiki\/(Q\d+)/)
  return match ? match[1] : null
}

type SourceResolution = { sourceType: 'article_context' | 'wikidata'; sourceText: string } | null

/** ソース解決: (1)ranking_article_context (2)Wikidataリンク経由Wikipediaリード文
 * (3)どちらも無ければnull(呼び出し側でスキップ扱いにする)。
 *
 * ranking_article_contextはartist_name列だけでは全テーブル横断の同名一致に
 * なってしまい、同姓同名の別人が選出された別企画の紹介文を拾ってしまう
 * リスクがある(app/admin/data/artists/unmatched/geminiMatchActions.tsの
 * runGeminiMatchForStubと同じ懸念)。そのため、このアーティストが実際に
 * 登場したranking_id/year(rankingRefs、buildPriorityIdsで収集済み)から
 * ranking_source_url.idを解決し、そのidの集合でranking_article_contextを
 * 絞り込む。同名で複数行ありうる(複数の元記事に登場)ため、各行の
 * from_location/key_track/bio_snippetを結合したテキストが最も長い行を採用する。
 * for_fans_ofは他アーティストとの比較であってこのアーティスト自身の事実では
 * ないため、Geminiに「○○譲り」のような裏取りできない作風系譜の主張を
 * させないよう、意図的に組み合わせテキストから除外している。 */
async function resolveSource(
  supabase: AdminClient,
  artist: ArtistRow,
  rankingRefs: RankingRef[]
): Promise<SourceResolution> {
  const sourceUrlIds = new Set<string>()
  for (const ref of rankingRefs) {
    if (ref.year === null) continue
    const { data: sourceUrl } = await supabase
      .from('ranking_source_url')
      .select('id')
      .eq('ranking_id', ref.rankingId)
      .eq('year', ref.year)
      .maybeSingle()
    if (sourceUrl) sourceUrlIds.add(sourceUrl.id)
  }

  let bestContextText = ''
  if (sourceUrlIds.size > 0) {
    const { data: contextRows } = await supabase
      .from('ranking_article_context')
      .select('from_location, key_track, bio_snippet')
      .in('ranking_source_url_id', [...sourceUrlIds])
      .ilike('artist_name', artist.name)

    for (const row of contextRows ?? []) {
      const parts: string[] = []
      if (row.from_location) parts.push(`出身地: ${row.from_location}`)
      if (row.key_track) parts.push(`代表曲: ${row.key_track}`)
      if (row.bio_snippet) parts.push(`紹介: ${row.bio_snippet}`)
      const combined = parts.join('\n')
      if (combined.length > bestContextText.length) bestContextText = combined
    }
  }
  if (bestContextText) return { sourceType: 'article_context', sourceText: bestContextText }

  const { data: linkRows } = await supabase
    .from('artist_external_link')
    .select('url')
    .eq('artist_id', artist.id)
    .ilike('url', '%wikidata.org%')
  for (const row of linkRows ?? []) {
    const qid = extractQid(row.url)
    if (!qid) continue
    const sitelink = await fetchWikipediaSitelink(qid)
    if (!sitelink) continue
    const leadText = await fetchWikipediaLeadText(sitelink.lang, sitelink.title)
    if (leadText) return { sourceType: 'wikidata', sourceText: leadText }
  }

  return null
}

async function fetchGenreNames(supabase: AdminClient, artistId: string): Promise<string[]> {
  const { data } = await supabase.from('artist_genre').select('genre:genre_id(name)').eq('artist_id', artistId)
  return (data ?? [])
    .map((row) => {
      const genre = row.genre as { name: string } | { name: string }[] | null
      return Array.isArray(genre) ? genre[0]?.name : genre?.name
    })
    .filter((name): name is string => Boolean(name))
}

type ProcessOutcome = 'applied' | 'skipped' | 'error'

async function processArtist(supabase: AdminClient, artist: ArtistRow, rankingRefs: RankingRef[]): Promise<ProcessOutcome> {
  let source: SourceResolution
  try {
    source = await resolveSource(supabase, artist, rankingRefs)
  } catch (err) {
    console.error(`  ソース解決に失敗: ${(err as Error).message}`)
    return 'error'
  }
  if (!source) return 'skipped'

  let genreNames: string[]
  try {
    genreNames = await fetchGenreNames(supabase, artist.id)
  } catch (err) {
    console.error(`  ジャンル取得に失敗: ${(err as Error).message}`)
    return 'error'
  }
  const facts: BioGenerationFacts = {
    artistName: artist.name,
    genreNames,
    formedYear: artist.formed_year,
    originPrefecture: artist.origin_prefecture,
    hometownCity: artist.hometown_city,
  }

  let result
  try {
    result = await generateArtistBioWithGemini(facts, source.sourceText, source.sourceType)
  } catch (err) {
    console.error(`  Gemini呼び出しに失敗: ${(err as Error).message}`)
    return 'error'
  }

  if (result.status === 'declined') return 'skipped'

  const { error: updateError } = await supabase
    .from('artist')
    .update({ bio: result.bio, biography_status: 'GENERATED' })
    .eq('id', artist.id)
  if (updateError) {
    console.error(`  DB更新に失敗: ${updateError.message}`)
    return 'error'
  }

  await supabase.from('bio_generation_log').insert({
    artist_id: artist.id,
    artist_name: artist.name,
    source_type: source.sourceType,
    source_excerpt: source.sourceText.slice(0, 2000),
    previous_bio: artist.bio,
    generated_bio: result.bio,
    status: 'applied',
  })

  safeRevalidatePath(`/artists/${artist.id}`)
  return 'applied'
}

async function main() {
  const supabase = createAdminClient()

  console.log('優先アーティスト一覧を作成中...')
  const { priorityIds, rankingRefsByArtist } = await buildPriorityIds(supabase)

  const artists: ArtistRow[] = []
  for (let i = 0; i < priorityIds.length; i += 500) {
    const { data } = await supabase
      .from('artist')
      .select('id, name, bio, biography_status, formed_year, origin_prefecture, hometown_city')
      .in('id', priorityIds.slice(i, i + 500))
    artists.push(...((data ?? []) as ArtistRow[]))
  }
  const artistById = new Map(artists.map((a) => [a.id, a]))

  const targets = priorityIds
    .map((id) => artistById.get(id))
    .filter(
      (a): a is ArtistRow => !!a && (!a.bio || a.bio.trim().length === 0) && a.biography_status !== 'REVERTED'
    )
  const scoped = LIMIT ? targets.slice(0, LIMIT) : targets

  console.log(`対象: ${scoped.length}件\n`)

  let applied = 0
  let skipped = 0
  let errors = 0

  for (const [index, artist] of scoped.entries()) {
    const rankingRefs = rankingRefsByArtist.get(artist.id) ?? []
    const status = await processArtist(supabase, artist, rankingRefs)
    console.log(`[${index + 1}/${scoped.length}] ${artist.name}: ${status}`)
    if (status === 'applied') applied += 1
    else if (status === 'skipped') skipped += 1
    else errors += 1
  }

  console.log('\n=== 完了 ===')
  console.log(`生成・公開: ${applied}件`)
  console.log(`スキップ(ソース無し/情報不足): ${skipped}件`)
  console.log(`エラー: ${errors}件`)
}

main()
