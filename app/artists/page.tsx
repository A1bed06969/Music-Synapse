import { createClient } from '@/utils/Supabase/server'
import { resolveArtistPageKind } from '@/utils/artistPageKind'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  // PostgRESTの1リクエストあたり行数上限(既定1000件)を超える全件取得は
  // .range()で分割する(credit_person/artist_creditは既にこの上限を超えている)
  async function fetchAllRows<T>(
    table: string,
    columns: string,
    order: string
  ): Promise<T[]> {
    const rows: T[] = []
    const pageSize = 1000
    let offset = 0
    while (true) {
      const { data } = await supabase
        .from(table)
        .select(columns)
        .order(order, { ascending: true })
        .range(offset, offset + pageSize - 1)
      const page = (data ?? []) as T[]
      rows.push(...page)
      if (page.length < pageSize) break
      offset += pageSize
    }
    return rows
  }

  const [{ data: allArtists }, { data: membershipRows }, { data: instruments }, creditPersons, creditRoleRows] =
    await Promise.all([
      supabase.from('artist').select('id, name, name_kana, name_en, image_url, page_override'),
      supabase
        .from('artist_relation')
        .select('artist_id_a, artist_id_b, band:artist_id_a(name)')
        .eq('relation_type', 'membership'),
      supabase.from('instrument').select('id, name'),
      fetchAllRows<{ id: string; name: string }>('credit_person', 'id, name', 'id'),
      fetchAllRows<{ credit_person_id: string; role: string; instrument_id: string | null }>(
        'artist_credit',
        'credit_person_id, role, instrument_id',
        'id'
      ),
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

  const instrumentNameById = new Map((instruments ?? []).map((i) => [i.id, i.name]))

  const rolesByPerson = new Map<string, Set<string>>()
  const instrumentsByPerson = new Map<string, Set<string>>()
  const instrumentCounts = new Map<string, number>()
  for (const row of creditRoleRows) {
    const roleSet = rolesByPerson.get(row.credit_person_id) ?? new Set<string>()
    roleSet.add(row.role)
    rolesByPerson.set(row.credit_person_id, roleSet)

    if (row.role === 'musician' && row.instrument_id) {
      const instrumentName = instrumentNameById.get(row.instrument_id)
      if (instrumentName) {
        const instrumentSet = instrumentsByPerson.get(row.credit_person_id) ?? new Set<string>()
        instrumentSet.add(instrumentName)
        instrumentsByPerson.set(row.credit_person_id, instrumentSet)
        instrumentCounts.set(instrumentName, (instrumentCounts.get(instrumentName) ?? 0) + 1)
      }
    }
  }
  const allInstruments = Array.from(instrumentCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name)

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
  const credits = creditPersons
    .map((p) => ({
      id: p.id,
      name: p.name,
      roles: Array.from(rolesByPerson.get(p.id) ?? []),
      instruments: Array.from(instrumentsByPerson.get(p.id) ?? []),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'))

  return <ArtistBrowseClient artists={artists} members={members} credits={credits} allInstruments={allInstruments} />
}
