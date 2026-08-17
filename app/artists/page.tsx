import { createClient } from '@/utils/Supabase/server'
import { resolveArtistPageKind } from '@/utils/artistPageKind'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  const [{ data: allArtists }, { data: membershipRows }, { data: creditPersons }] = await Promise.all([
    supabase.from('artist').select('id, name, name_kana, name_en, image_url, page_override'),
    supabase
      .from('artist_relation')
      .select('artist_id_a, artist_id_b, band:artist_id_a(name)')
      .eq('relation_type', 'membership'),
    supabase.from('credit_person').select('id, name').order('name'),
  ])

  // 本人名義のリリース(album/track)有無を判定するため、全件をページングで取得する
  // (PostgRESTの1リクエストあたり行数上限を超えないよう分割)
  async function fetchAllArtistIdsFrom(table: 'album' | 'track'): Promise<Set<string>> {
    const ids = new Set<string>()
    const pageSize = 1000
    let offset = 0
    while (true) {
      const { data } = await supabase.from(table).select('artist_id').order('id', { ascending: true }).range(offset, offset + pageSize - 1)
      const rows = data ?? []
      for (const row of rows) {
        if (row.artist_id) ids.add(row.artist_id)
      }
      if (rows.length < pageSize) break
      offset += pageSize
    }
    return ids
  }

  const [releasedByAlbum, releasedByTrack] = await Promise.all([
    fetchAllArtistIdsFrom('album'),
    fetchAllArtistIdsFrom('track'),
  ])
  const releasedIds = new Set<string>([...releasedByAlbum, ...releasedByTrack])

  const memberOfIds = new Map<string, string[]>() // memberId -> band names
  for (const row of membershipRows ?? []) {
    if (!row.artist_id_b) continue
    const band = Array.isArray(row.band) ? row.band[0] : row.band
    if (!band?.name) continue
    const list = memberOfIds.get(row.artist_id_b) ?? []
    list.push(band.name)
    memberOfIds.set(row.artist_id_b, list)
  }

  const artists: {
    id: string
    name: string
    name_kana: string | null
    name_en: string | null
    image_url: string | null
  }[] = []
  const members: {
    id: string
    name: string
    name_kana: string | null
    name_en: string | null
    image_url: string | null
    bandNames: string[]
  }[] = []

  for (const a of allArtists ?? []) {
    const isMember = memberOfIds.has(a.id)
    const kind = resolveArtistPageKind(a.page_override, isMember, releasedIds.has(a.id))
    if (kind === 'member') {
      members.push({
        id: a.id,
        name: a.name,
        name_kana: a.name_kana,
        name_en: a.name_en,
        image_url: a.image_url,
        bandNames: memberOfIds.get(a.id) ?? [],
      })
    } else {
      artists.push({
        id: a.id,
        name: a.name,
        name_kana: a.name_kana,
        name_en: a.name_en,
        image_url: a.image_url,
      })
    }
  }

  artists.sort((a, b) => (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja'))
  members.sort((a, b) => (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja'))
  const credits = (creditPersons ?? []).map((p) => ({ id: p.id, name: p.name }))

  return <ArtistBrowseClient artists={artists} members={members} credits={credits} />
}
