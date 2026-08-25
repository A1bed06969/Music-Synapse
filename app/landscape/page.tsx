import { createClient } from '@/utils/Supabase/server'
import type { LineageEdge } from '@/utils/genreHistory'
import { resolveRootGenreName, calculateLandscapePosition } from '@/lib/landscape/coordinate'
import { colorForGenre } from '@/lib/landscape/genreColors'
import LandscapeView, { type LandscapeArtist } from './LandscapeView'

export const maxDuration = 60

export const metadata = {
  title: 'ミュージックランドスケープ | Music Synapse',
  description: 'アーティストをジャンルの近さで空間に配置し、検索ではなく探索で音楽と出会うためのビジュアライゼーション。',
}

const PER_GENRE_CAP = 15

/** artist_genre(疎だが直接タグ)とgenre_highlight(このセッションで構築した
 * ジャンル年表由来、より充実)の両方から、アーティストごとに1件だけ具体
 * ジャンルを採用する。両方に存在する場合はgenre_highlight(ジャンル年表側)を
 * 優先する(キュレーションされた代表アーティスト紐付けの方が質が高いため)。
 * 同じアーティストが複数ジャンルに紐づく場合は最初に見つかったものを採用する
 * (MVPでは1アーティスト=1ジャンルに単純化)。 */
function pickPrimaryGenrePerArtist(
  highlightRows: { artist_id: string | null; genre_id: string }[],
  tagRows: { artist_id: string; genre_id: string }[]
): Map<string, string> {
  const genreIdByArtistId = new Map<string, string>()
  for (const row of highlightRows) {
    if (!row.artist_id) continue
    if (genreIdByArtistId.has(row.artist_id)) continue
    genreIdByArtistId.set(row.artist_id, row.genre_id)
  }
  for (const row of tagRows) {
    if (genreIdByArtistId.has(row.artist_id)) continue
    genreIdByArtistId.set(row.artist_id, row.genre_id)
  }
  return genreIdByArtistId
}

export default async function LandscapePage() {
  const supabase = await createClient()

  const [{ data: lineageRows }, { data: genreRows }, { data: highlightRows }, { data: tagRows }] = await Promise.all([
    supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type'),
    supabase.from('genre').select('id, name'),
    supabase.from('genre_highlight').select('artist_id, genre_id').not('artist_id', 'is', null),
    supabase.from('artist_genre').select('artist_id, genre_id'),
  ])

  const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
    parentGenreId: r.parent_genre_id,
    childGenreId: r.child_genre_id,
    relationType: (r.relation_type as LineageEdge['relationType']) ?? 'derivation',
  }))
  const genreNameById = new Map((genreRows ?? []).map((g) => [g.id, g.name]))

  const genreIdByArtistId = pickPrimaryGenrePerArtist(
    (highlightRows ?? []) as { artist_id: string | null; genre_id: string }[],
    (tagRows ?? []) as { artist_id: string; genre_id: string }[]
  )

  // 1アーティストが複数のgenre_highlightに登場する回数を軽い「重要度」の
  // シグナルとして使う(仕様11番: 既存DBに専用の重要度指標が無い場合は
  // まず簡易な値でよい、を踏襲。将来Discography数/Award等に置き換え可能)
  const highlightCountByArtistId = new Map<string, number>()
  for (const row of highlightRows ?? []) {
    if (!row.artist_id) continue
    highlightCountByArtistId.set(row.artist_id, (highlightCountByArtistId.get(row.artist_id) ?? 0) + 1)
  }

  // モバイルでの描画負荷とサーバー側のレスポンス時間を抑えるため、
  // 「まず全アーティストの詳細をDBから取得してから間引く」のではなく、
  // ジャンル解決とhighlight件数(ここまでは既に手元にあるデータのみのJS処理、
  // 追加のDB往復は無い)だけで先に対象を絞り込み、artistテーブルへの問い合わせは
  // 最終的に必要な分だけ行う。以前の実装では間引きをartist取得の後段に置いていた
  // ため、実際には799件全件分artistテーブルへ問い合わせており、モバイル経由の
  // 遅い回線ではサーバー応答自体が遅延・タイムアウトしていた可能性が高い。
  const rootGenreByArtistId = new Map<string, string | null>()
  const specificGenreByArtistId = new Map<string, string | null>()
  for (const [artistId, genreId] of genreIdByArtistId) {
    specificGenreByArtistId.set(artistId, genreNameById.get(genreId) ?? null)
    rootGenreByArtistId.set(artistId, resolveRootGenreName(genreId, genreNameById, edges))
  }

  const idsByGenre = new Map<string, string[]>()
  for (const [artistId] of genreIdByArtistId) {
    const key = rootGenreByArtistId.get(artistId) ?? '__unclassified__'
    const list = idsByGenre.get(key) ?? []
    list.push(artistId)
    idsByGenre.set(key, list)
  }

  const selectedArtistIds: string[] = []
  for (const ids of idsByGenre.values()) {
    ids.sort((a, b) => (highlightCountByArtistId.get(b) ?? 0) - (highlightCountByArtistId.get(a) ?? 0))
    selectedArtistIds.push(...ids.slice(0, PER_GENRE_CAP))
  }

  const artistsById = new Map<
    string,
    { id: string; name: string; image_url: string | null; hometown_city: string | null; hometown_country: string | null; formed_year: number | null }
  >()
  // 300件を超えるケースへの保険としてチャンク分割+並列取得にしておく
  // (以前は逐次awaitのforループで、必要以上に遅くなっていた)
  const CHUNK = 300
  const chunks: string[][] = []
  for (let i = 0; i < selectedArtistIds.length; i += CHUNK) chunks.push(selectedArtistIds.slice(i, i + CHUNK))
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      supabase.from('artist').select('id, name, image_url, hometown_city, hometown_country, formed_year').in('id', chunk)
    )
  )
  for (const { data } of chunkResults) {
    for (const a of data ?? []) artistsById.set(a.id, a)
  }

  const landscapeArtists: LandscapeArtist[] = []
  for (const artistId of selectedArtistIds) {
    const artist = artistsById.get(artistId)
    if (!artist) continue

    const specificGenreName = specificGenreByArtistId.get(artistId) ?? null
    const rootGenreName = rootGenreByArtistId.get(artistId) ?? null
    const position = calculateLandscapePosition({ seedId: artistId, rootGenreName, specificGenreName })
    const highlightCount = highlightCountByArtistId.get(artistId) ?? 0

    landscapeArtists.push({
      artistId,
      name: artist.name,
      imageUrl: artist.image_url,
      rootGenre: rootGenreName,
      specificGenre: specificGenreName,
      origin: artist.hometown_city ?? artist.hometown_country ?? null,
      formedYear: artist.formed_year,
      x: position.x,
      y: position.y,
      importance: 1 + Math.min(highlightCount, 4) * 0.12,
      color: colorForGenre(rootGenreName),
    })
  }

  const genreOptions = [...new Set(landscapeArtists.map((a) => a.rootGenre).filter((g): g is string => !!g))].sort((a, b) =>
    a.localeCompare(b)
  )

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">MUSIC LANDSCAPE</h1>
      <p className="mt-2 text-sm text-white/50">
        アーティストをジャンルの近さで空間に配置した地図。検索するのではなく、眺めながら歩いて音楽と出会うためのビジュアライゼーションです。
        (現在は各ジャンル上位{PER_GENRE_CAP}組・{landscapeArtists.length}組を表示中)
      </p>

      <div className="mt-8">
        <LandscapeView artists={landscapeArtists} genreOptions={genreOptions} />
      </div>
    </div>
  )
}
