import { createClient } from '@/utils/Supabase/server'
import { resolveArtistPageKind } from '@/utils/artistPageKind'
import { fetchAllRows } from '@/utils/fetchAllRows'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  type ArtistRow = {
    id: string
    name: string
    name_kana: string | null
    name_en: string | null
    image_url: string | null
    page_override: string | null
  }

  type MembershipRow = {
    artist_id_a: string
    artist_id_b: string
    relation_type: string
    band: { name: string } | { name: string }[] | null
  }

  const [allArtists, allRelations, { data: instruments }, creditPersons, creditRoleRows] =
    await Promise.all([
      // 2026年8月時点でアーティスト総数がPostgRESTの1リクエストあたり行数上限(既定1000件)を
      // 超え、この上限のせいで最近登録されたアーティストがアーティスト一覧・検索に
      // 一切出てこない不具合が実際に発生した(例: Radio Fabres)。credit_person/artist_credit
      // と同様にページングする
      fetchAllRows<ArtistRow>(supabase, 'artist', 'id, name, name_kana, name_en, image_url, page_override', 'id'),
      // artist_relationは1675件でPostgRESTの上限(1000件)を超え、うちmembership種別
      // だけでも1641件ある。.eq()で絞ってもページングしないと後半のmembership行が
      // 欠落する(メンバーページのバンド名表示が一部抜け落ちる)ため、全件ページングで
      // 取得してからJS側でmembership種別に絞り込む
      fetchAllRows<MembershipRow>(supabase, 'artist_relation', 'artist_id_a, artist_id_b, relation_type, band:artist_id_a(name)', 'id'),
      supabase.from('instrument').select('id, name'),
      fetchAllRows<{ id: string; name: string }>(supabase, 'credit_person', 'id, name', 'id'),
      fetchAllRows<{ credit_person_id: string; role: string; instrument_id: string | null }>(
        supabase,
        'artist_credit',
        'credit_person_id, role, instrument_id',
        'id'
      ),
    ])

  // 本人名義のリリース(album/track)有無を判定するため、artist_idの集合が欲しいだけ
  // なのに、以前は全行(trackだけで131,000件超)を1000件ずつ逐次ページングして
  // いた(132回の逐次往復が発生し、ページ生成に50秒以上かかる原因になっていた)。
  // Postgres側でDISTINCTした結果だけをRPCで返すよう変更する(distinct_*_artist_ids、
  // supabase/migrations/20260826_add_distinct_artist_ids_rpc.sql)。RPCの戻り値も
  // PostgRESTの1リクエストあたり行数上限(1000件)の対象になるため、それでも
  // ページングは必要だが、artist総数(2687件)が上限のため最大でも3往復で済む
  async function fetchDistinctArtistIdsFrom(rpcName: 'distinct_album_artist_ids' | 'distinct_track_artist_ids'): Promise<Set<string>> {
    const ids = new Set<string>()
    const pageSize = 1000
    let offset = 0
    while (true) {
      const { data } = await supabase.rpc(rpcName).range(offset, offset + pageSize - 1)
      const rows = (data ?? []) as { artist_id: string }[]
      for (const row of rows) ids.add(row.artist_id)
      if (rows.length < pageSize) break
      offset += pageSize
    }
    return ids
  }

  const [releasedByAlbum, releasedByTrack] = await Promise.all([
    fetchDistinctArtistIdsFrom('distinct_album_artist_ids'),
    fetchDistinctArtistIdsFrom('distinct_track_artist_ids'),
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

  const membershipRows = allRelations.filter((r) => r.relation_type === 'membership')

  const memberOfIds = new Map<string, string[]>() // memberId -> band names
  for (const row of membershipRows) {
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
    const kind = resolveArtistPageKind(a.page_override, releasedIds.has(a.id))
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
