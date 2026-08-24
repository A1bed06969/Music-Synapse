import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { buildEraCards, buildGenreEvolutionTree, getDescendantGenreIds, type GenreRow, type LineageEdge, type HighlightRow } from '@/utils/genreHistory'
import GenreHistoryView from './GenreHistoryView'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function GenreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: genre, error } = await supabase.from('genre').select('*').eq('id', id).single()
  if (error || !genre) {
    notFound()
  }

  // genre_lineageは全体で高々数十行のため、対象ジャンルに絞らず全件取得して
  // utils/genreHistory.tsのgetDescendantGenreIds/buildGenreEvolutionTreeに渡す
  // (多段階の子孫を辿るには、どこまで辿れば止まるか事前にはわからないため)
  const { data: lineageRows } = await supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type')
  const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
    parentGenreId: r.parent_genre_id,
    childGenreId: r.child_genre_id,
    relationType: r.relation_type as 'derivation' | 'influence' | 'crossover',
  }))

  // buildEraCards/buildGenreEvolutionTree内部でも同じ列挙をするが、genreHighlightを
  // どのジャンルID分取得すればよいかを先に知る必要があるため、ここでも呼び出す
  const allGenreIds = getDescendantGenreIds(id, edges)

  const [{ data: genreRows }, { data: highlightRows }] = await Promise.all([
    supabase
      .from('genre')
      .select('id, name, origin_year, origin_year_label, origin_country, background_note')
      .in('id', allGenreIds),
    supabase
      .from('genre_highlight')
      .select('genre_id, note, event_year, event_year_label, artist:artist_id(id, name, image_url), album:album_id(id, title, jacket_url)')
      .in('genre_id', allGenreIds),
  ])

  const genres: GenreRow[] = (genreRows ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    originYear: g.origin_year,
    originYearLabel: g.origin_year_label,
    originCountry: g.origin_country,
    backgroundNote: g.background_note,
  }))

  const highlights: HighlightRow[] = (highlightRows ?? []).map((h) => {
    const artist = firstOf(h.artist)
    const album = firstOf(h.album)
    return {
      genreId: h.genre_id,
      artistId: artist?.id ?? null,
      artistName: artist?.name ?? null,
      artistImageUrl: artist?.image_url ?? null,
      albumId: album?.id ?? null,
      albumTitle: album?.title ?? null,
      albumJacketUrl: album?.jacket_url ?? null,
      eventYear: h.event_year,
      eventYearLabel: h.event_year_label,
      note: h.note,
    }
  })

  const eraCards = buildEraCards(id, genres, edges, highlights)
  const { nodes: evolutionNodes, edges: evolutionEdges } = buildGenreEvolutionTree(id, genres, edges)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">{genre.name}</h1>
      {genre.wikipedia_url && (
        <a
          href={genre.wikipedia_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://www.google.com/s2/favicons?domain=wikipedia.org&sz=64"
            alt=""
            className="h-3.5 w-3.5"
          />
          Wikipediaで確認 →
        </a>
      )}

      <GenreHistoryView
        genreName={genre.name}
        eraCards={eraCards}
        evolutionNodes={evolutionNodes}
        evolutionEdges={evolutionEdges}
      />
    </div>
  )
}
