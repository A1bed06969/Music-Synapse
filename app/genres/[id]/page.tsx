import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import GenreTimeline from './GenreTimeline'

export default async function GenreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: genre, error } = await supabase.from('genre').select('*').eq('id', id).single()

  if (error || !genre) {
    notFound()
  }

  const { data: lineageRows } = await supabase
    .from('genre_lineage')
    .select('child:child_genre_id(id, name, origin_year, origin_year_label, origin_country, origin_city)')
    .eq('parent_genre_id', id)

  function firstOf<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null
    return value ?? null
  }

  type ChildGenre = {
    id: string
    name: string
    origin_year: number | null
    origin_year_label: string | null
    origin_country: string | null
    origin_city: string | null
  }
  const children = (lineageRows ?? [])
    .map((r) => firstOf(r.child))
    .filter((c): c is ChildGenre => c !== null)
  const childIds = children.map((c) => c.id)
  const allGenreIds = [id, ...childIds]

  const [{ data: highlights }, { data: artistGenreRows }] = await Promise.all([
    supabase
      .from('genre_highlight')
      .select('id, genre_id, note, artist:artist_id(id, name), album:album_id(id, title)')
      .in('genre_id', allGenreIds),
    supabase.from('artist_genre').select('artist_id').eq('genre_id', id),
  ])

  const artistIds = (artistGenreRows ?? []).map((r) => r.artist_id)
  const { data: releases } = artistIds.length
    ? await supabase
        .from('album')
        .select('id, title, release_date, artist:artist_id(id, name)')
        .in('artist_id', artistIds)
        .is('primary_album_id', null)
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(200)
    : { data: [] }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">{genre.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
        {(genre.origin_year_label || genre.origin_year) && (
          <span>発祥 {genre.origin_year_label || `${genre.origin_year}年`}</span>
        )}
        {(genre.origin_country || genre.origin_city) && (
          <span>{[genre.origin_country, genre.origin_city].filter(Boolean).join(' / ')}</span>
        )}
      </div>
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

      <section className="mt-8">
        <h2 className="text-lg font-semibold">年表</h2>
        <GenreTimeline
          genreId={id}
          genreName={genre.name}
          originYear={genre.origin_year}
          originYearLabel={genre.origin_year_label}
          originCountry={genre.origin_country}
          originCity={genre.origin_city}
          // eslint-disable-next-line react/no-children-prop -- `children` here is a data prop (child genres), not renderable content
          children={children}
          highlights={highlights ?? []}
          releases={releases ?? []}
        />
      </section>
    </div>
  )
}
