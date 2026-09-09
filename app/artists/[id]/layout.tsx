// app/artists/[id]/layout.tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistSectionCounts } from '@/utils/artistDetailCounts'
import ArtistIdentityPanel, { type ArtistIdentityData } from '@/app/components/artist-detail/ArtistIdentityPanel'
import ArtistNav from '@/app/components/artist-detail/ArtistNav'
import ArtistNavMobile from '@/app/components/artist-detail/ArtistNavMobile'
import BackLink from '@/app/components/navigation/BackLink'
import MemberProfile from './MemberProfile'

type ArtistRow = {
  id: string
  name: string
  name_kana: string | null
  name_en: string | null
  image_url: string | null
  bio: string | null
  formed_year: number | null
  disbanded_year: number | null
  active_status: string | null
  hometown_country: string | null
  origin_prefecture: string | null
  hometown_city: string | null
  official_site_url: string | null
  sns_x_url: string | null
  sns_instagram_url: string | null
  apple_music_artist_id: string | null
  spotify_artist_id: string | null
  browse_kind: string | null
}

export default async function ArtistDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: artist, error }, { data: genreRows }, { data: externalLinks }] = await Promise.all([
    supabase.from('artist').select('*').eq('id', id).single<ArtistRow>(),
    supabase.from('artist_genre').select('genre:genre_id(name)').eq('artist_id', id),
    supabase
      .from('artist_external_link')
      .select('id, link_type, url')
      .eq('artist_id', id)
      .order('link_type', { ascending: true })
      .order('url', { ascending: true }),
  ])

  if (error || !artist) {
    notFound()
  }

  if (artist.browse_kind === 'member') {
    const { data: membershipRows } = await supabase
      .from('artist_relation')
      .select('id, description, band:artist_id_a(id, name, image_url), member:artist_id_b(id, name, image_url)')
      .eq('relation_type', 'membership')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    const belongsToBands: { id: string; name: string; description: string | null }[] = []
    for (const row of membershipRows ?? []) {
      const band = Array.isArray(row.band) ? row.band[0] : row.band
      const member = Array.isArray(row.member) ? row.member[0] : row.member
      if (band && member?.id === id) belongsToBands.push({ id: band.id, name: band.name, description: row.description })
    }
    const { data: productionRows } = await supabase
      .from('artist_relation')
      .select('id, description, artist_a:artist_id_a(id, name), artist_b:artist_id_b(id, name)')
      .eq('relation_type', 'production')
      .or(`artist_id_a.eq.${id},artist_id_b.eq.${id}`)
    const productions = (productionRows ?? [])
      .map((row) => {
        const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
        const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
        if (!a || !b) return null
        const other = a.id === id ? b : a
        return { id: row.id, artistId: other.id, artistName: other.name, description: row.description }
      })
      .filter((row): row is { id: number; artistId: string; artistName: string; description: string | null } => row !== null)

    return (
      <MemberProfile
        name={artist.name}
        nameKana={artist.name_kana}
        nameEn={artist.name_en}
        imageUrl={artist.image_url}
        bio={artist.bio}
        bands={belongsToBands}
        productions={productions}
      />
    )
  }

  const counts = await fetchArtistSectionCounts(supabase, id)

  const identity: ArtistIdentityData = {
    id: artist.id,
    name: artist.name,
    nameKana: artist.name_kana,
    nameEn: artist.name_en,
    imageUrl: artist.image_url,
    bio: artist.bio,
    formedYear: artist.formed_year,
    disbandedYear: artist.disbanded_year,
    activeStatus: artist.active_status,
    hometownCountry: artist.hometown_country,
    originPrefecture: artist.origin_prefecture,
    hometownCity: artist.hometown_city,
    genreNames: (genreRows ?? [])
      .map((r) => {
        const genre = Array.isArray(r.genre) ? r.genre[0] : r.genre
        return genre?.name
      })
      .filter((name): name is string => Boolean(name)),
    officialSiteUrl: artist.official_site_url,
    snsXUrl: artist.sns_x_url,
    snsInstagramUrl: artist.sns_instagram_url,
    appleMusicArtistId: artist.apple_music_artist_id,
    spotifyArtistId: artist.spotify_artist_id,
    externalLinks: externalLinks ?? [],
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <BackLink fallbackHref="/search" fallbackLabel="検索に戻る" />
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(280px,4fr)_minmax(320px,4fr)_minmax(180px,2fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ArtistIdentityPanel data={identity} />
        </div>
        <div className="min-w-0">{children}</div>
        <div className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
          <ArtistNav artistId={id} counts={counts} />
        </div>
        <div className="lg:hidden">
          <ArtistNavMobile artistId={id} counts={counts} />
        </div>
      </div>
    </div>
  )
}
