// app/artists/[id]/layout.tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistSectionCounts } from '@/utils/artistDetailCounts'
import { findRelatedNews } from '@/utils/newsParser'
import { fetchCachedNews } from '@/utils/newsCache'
import ArtistIdentityPanel, { type ArtistIdentityData } from '@/app/components/artist-detail/ArtistIdentityPanel'
import ArtistNav from '@/app/components/artist-detail/ArtistNav'
import ArtistNavMobile from '@/app/components/artist-detail/ArtistNavMobile'
import StickyMiniHeader from '@/app/components/detail/StickyMiniHeader'
import BackLink from '@/app/components/navigation/BackLink'
import SiteFooter from '@/app/components/SiteFooter'
import MemberProfile from './MemberProfile'

// SiteHeaderの実測高さ(border込み)。デスクトップのLEFT/RIGHTカラムをこの下に
// 固定するための基準値としてだけ使う(サイトヘッダーの高さが変わったら要更新)。
const HEADER_HEIGHT_PX = 57

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

  const [counts, { items: newsItemsForCount }] = await Promise.all([
    fetchArtistSectionCounts(supabase, id),
    fetchCachedNews(),
  ])
  const mediaCount = findRelatedNews(
    newsItemsForCount,
    [artist.name, artist.name_kana, artist.name_en].filter((k): k is string => Boolean(k)),
    30
  ).length
  counts.media = mediaCount

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
    <div className="lg:flex lg:flex-row lg:overflow-hidden" style={{ ['--artist-shell-h' as string]: `calc(100vh - ${HEADER_HEIGHT_PX}px)` }}>
      {/* ===== Mobile(lg:未満): 通常のページスクロール、縦積み ===== */}
      <div className="px-6 pt-3 lg:hidden">
        <BackLink fallbackHref="/search" fallbackLabel="検索に戻る" />
      </div>
      <StickyMiniHeader watchElementId="artist-header" imageUrl={identity.imageUrl} title={identity.name} />
      <div className="px-6 lg:hidden">
        <div className="mt-3">
          <ArtistIdentityPanel data={identity} />
        </div>
        <div className="mt-6">
          <ArtistNavMobile artistId={id} counts={counts} />
        </div>
        <div className="mt-8 min-w-0 pb-8">{children}</div>
      </div>
      <div className="lg:hidden">
        <SiteFooter />
      </div>

      {/* ===== Desktop(lg:以上): LEFT/RIGHTは固定、CENTERだけが独立スクロールし
          フッターもCENTERの中にだけ表示する。RIGHTは9項目のラベル+件数だけで
          実測166px程度しか必要ないため狭め、その分LEFTを広げて「視聴」リンクが
          折り返さず1列に収まるようにする(実測、1列に必要な幅は約393px)。 ===== */}
      <div
        className="hidden lg:block lg:h-[var(--artist-shell-h)] lg:w-[38%] lg:min-w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-white/5"
      >
        <div className="px-8 pt-3">
          <BackLink fallbackHref="/search" fallbackLabel="検索に戻る" />
          <div className="mt-3">
            <ArtistIdentityPanel data={identity} />
          </div>
        </div>
      </div>
      <div className="hidden lg:block lg:h-[var(--artist-shell-h)] lg:min-w-0 lg:flex-1 lg:overflow-y-auto">
        <div className="px-8 pt-4 pb-8">{children}</div>
        <SiteFooter />
      </div>
      <div
        className="hidden lg:block lg:h-[var(--artist-shell-h)] lg:w-[18%] lg:min-w-[220px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-white/5"
      >
        <div className="px-8 pt-4">
          <ArtistNav artistId={id} counts={counts} />
        </div>
      </div>
    </div>
  )
}
