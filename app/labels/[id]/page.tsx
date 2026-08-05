import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { formatDate } from '@/utils/format'

export default async function LabelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: label, error } = await supabase.from('label').select('*').eq('id', id).single()

  if (error || !label) {
    notFound()
  }

  const [{ data: founders }, { data: roster }, { data: catalog }] = await Promise.all([
    supabase.from('label_founder').select('role, person:person_id(id, name, name_kana)').eq('label_id', id),
    supabase
      .from('artist_label')
      .select('start_date, end_date, artist:artist_id(id, name)')
      .eq('label_id', id)
      .order('start_date', { ascending: true }),
    supabase
      .from('album')
      .select('id, title, jacket_url, release_date, artist:artist_id(id, name)')
      .eq('label_id', id)
      .order('release_date', { ascending: false, nullsFirst: false }),
  ])

  function firstOf<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null
    return value ?? null
  }

  const artistIds = Array.from(
    new Set(
      (roster ?? [])
        .map((r) => firstOf(r.artist)?.id)
        .filter((artistId): artistId is string => Boolean(artistId))
    )
  )
  const albumIds = (catalog ?? []).map((a) => a.id)

  const { data: awards } =
    artistIds.length || albumIds.length
      ? await supabase
          .from('award_entry')
          .select(
            'year, category, result, award:award_id(name), artist:artist_id(name), album:album_id(title)'
          )
          .or(
            [
              artistIds.length ? `artist_id.in.(${artistIds.join(',')})` : null,
              albumIds.length ? `album_id.in.(${albumIds.join(',')})` : null,
            ]
              .filter(Boolean)
              .join(',')
          )
          .order('year', { ascending: false })
      : { data: [] }

  const activeRoster = (roster ?? []).filter((r) => !r.end_date)
  const formerRoster = (roster ?? []).filter((r) => r.end_date)

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">{label.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-white/50">
        {label.name_kana && <span>{label.name_kana}</span>}
        {label.founded_year && <span>設立 {label.founded_year}年</span>}
      </div>

      {label.description && (
        <p className="mt-6 text-sm leading-relaxed text-white/70">{label.description}</p>
      )}

      {founders && founders.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">創設者</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {founders.map((f, i) => {
              const person = Array.isArray(f.person) ? f.person[0] : f.person
              if (!person) return null
              return (
                <li key={i} className="flex justify-between text-white/70">
                  <span>{person.name}</span>
                  {f.role && <span className="text-white/40">{f.role}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">所属アーティスト</h2>
        {activeRoster.length === 0 && formerRoster.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだ所属アーティストが登録されていません。</p>
        ) : (
          <>
            {activeRoster.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-white/40">現役</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {activeRoster.map((r, i) => {
                    const artist = Array.isArray(r.artist) ? r.artist[0] : r.artist
                    if (!artist) return null
                    return (
                      <Link
                        key={i}
                        href={`/artists/${artist.id}`}
                        className="rounded-full border border-white/15 px-3 py-1 text-sm hover:bg-white/5"
                      >
                        {artist.name}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
            {formerRoster.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-white/40">歴代</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {formerRoster.map((r, i) => {
                    const artist = Array.isArray(r.artist) ? r.artist[0] : r.artist
                    if (!artist) return null
                    return (
                      <Link
                        key={i}
                        href={`/artists/${artist.id}`}
                        className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/60 hover:bg-white/5"
                      >
                        {artist.name}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">カタログ</h2>
        {!catalog || catalog.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだアルバムが登録されていません。</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {catalog.map((album) => {
              const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist
              return (
                <Link key={album.id} href={`/albums/${album.id}`} className="group block">
                  <div className="aspect-square overflow-hidden rounded-md bg-white/5">
                    {album.jacket_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={album.jacket_url}
                        alt={album.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/20">
                        No Art
                      </div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{album.title}</p>
                  <p className="truncate text-xs text-white/50">{artist?.name}</p>
                  <p className="text-xs text-white/30">{formatDate(album.release_date)}</p>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">アワード受賞実績</h2>
        {!awards || awards.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">まだ受賞実績が登録されていません。</p>
        ) : (
          <ul className="mt-4 space-y-1.5 text-sm">
            {awards.map((entry, i) => {
              const award = Array.isArray(entry.award) ? entry.award[0] : entry.award
              const artist = Array.isArray(entry.artist) ? entry.artist[0] : entry.artist
              const album = Array.isArray(entry.album) ? entry.album[0] : entry.album
              return (
                <li key={i} className="flex justify-between text-white/70">
                  <span>
                    {entry.year} {award?.name} {entry.category}
                  </span>
                  <span className="text-white/40">
                    {artist?.name ?? album?.title} {entry.result && `(${entry.result})`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
