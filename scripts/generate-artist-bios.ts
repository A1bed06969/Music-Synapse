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

type RankingEntryRow = { artist_id: string | null; album_id: string | null; track_id: string | null }

/** 選出・表彰(ranking_entry)を持つアーティストIDを、件数の多い順に並べて返す。
 * ranking_entryはartist_id直付け・album_id経由・track_id経由の3パターンが
 * 混在するため、album/trackのartist_idをまとめて引いてから件数を数える。 */
async function buildPriorityIds(supabase: AdminClient): Promise<string[]> {
  const entries = await fetchAllRows<RankingEntryRow>(supabase, 'ranking_entry', 'artist_id, album_id, track_id', 'id')

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
  for (const entry of entries) {
    const artistId =
      entry.artist_id ??
      (entry.album_id ? albumArtistById.get(entry.album_id) : undefined) ??
      (entry.track_id ? trackArtistById.get(entry.track_id) : undefined)
    if (!artistId) continue
    countByArtist.set(artistId, (countByArtist.get(artistId) ?? 0) + 1)
  }

  return [...countByArtist.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

function extractQid(wikidataUrl: string): string | null {
  const match = wikidataUrl.match(/\/wiki\/(Q\d+)/)
  return match ? match[1] : null
}

type SourceResolution = { sourceType: 'article_context' | 'wikidata'; sourceText: string } | null

/** ソース解決: (1)ranking_article_context (2)Wikidataリンク経由Wikipediaリード文
 * (3)どちらも無ければnull(呼び出し側でスキップ扱いにする)。
 * ranking_article_contextは同名で複数行ありうる(複数の元記事に登場)ため、
 * 各行のfrom_location/for_fans_of/key_track/bio_snippetを結合したテキストが
 * 最も長い行を採用する。 */
async function resolveSource(supabase: AdminClient, artist: ArtistRow): Promise<SourceResolution> {
  const { data: contextRows } = await supabase
    .from('ranking_article_context')
    .select('from_location, for_fans_of, key_track, bio_snippet')
    .eq('artist_name', artist.name)

  let bestContextText = ''
  for (const row of contextRows ?? []) {
    const parts: string[] = []
    if (row.from_location) parts.push(`出身地: ${row.from_location}`)
    if (row.for_fans_of) parts.push(`近しいアーティスト: ${row.for_fans_of}`)
    if (row.key_track) parts.push(`代表曲: ${row.key_track}`)
    if (row.bio_snippet) parts.push(`紹介: ${row.bio_snippet}`)
    const combined = parts.join('\n')
    if (combined.length > bestContextText.length) bestContextText = combined
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

async function processArtist(supabase: AdminClient, artist: ArtistRow): Promise<ProcessOutcome> {
  let source: SourceResolution
  try {
    source = await resolveSource(supabase, artist)
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
  const priorityIds = await buildPriorityIds(supabase)

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
    const status = await processArtist(supabase, artist)
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
