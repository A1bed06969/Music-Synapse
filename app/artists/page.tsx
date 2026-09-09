import { unstable_cache } from 'next/cache'
import { createClient } from '@/utils/Supabase/server'
import ArtistBrowseClient, { type BrowseTab } from './ArtistBrowseClient'

// 1ページあたりの表示件数。以前はartist 17,349件・credit_person 19,365件・
// artist_credit 123,177行を全件取得してブラウザ側で絞り込んでいたため、
// HTMLが9MB・生成に62秒かかっていた。DB側で絞ってページ単位で返す。
const PAGE_SIZE = 60

type ArtistRow = {
  id: string
  name: string
  name_kana: string | null
  name_en: string | null
  image_url: string | null
}

type CreditPersonRow = {
  id: string
  name: string
  roles: string[]
  instruments: string[]
  total_count: number
}

/** 楽器の絞り込みプルダウンの選択肢。artist_credit全件の集計になるが内容は
 * ほぼ変わらないため、リクエストごとに数えず1時間キャッシュする。 */
const getInstrumentOptions = unstable_cache(
  async (): Promise<string[]> => {
    const { createClient: createAnonClient } = await import('@supabase/supabase-js')
    const supabase = createAnonClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await supabase.rpc('credit_instrument_options')
    return ((data ?? []) as { name: string }[]).map((row) => row.name)
  },
  ['credit-instrument-options'],
  { revalidate: 3600 }
)

function parseTab(value: string | undefined): BrowseTab {
  return value === 'member' || value === 'credit' ? value : 'artist'
}

export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; role?: string; instrument?: string }>
}) {
  const params = await searchParams
  const tab = parseTab(params.tab)
  const query = (params.q ?? '').trim()
  const page = Math.max(0, Number(params.page ?? 0) || 0)
  const role = params.role ?? 'all'
  const instrument = params.instrument ?? 'all'
  const offset = page * PAGE_SIZE

  const supabase = await createClient()

  let artists: ArtistRow[] = []
  let members: (ArtistRow & { bandNames: string[] })[] = []
  let credits: { id: string; name: string; roles: string[]; instruments: string[] }[] = []
  let totalCount = 0
  let instrumentOptions: string[] = []

  if (tab === 'artist' || tab === 'member') {
    let request = supabase
      .from('artist')
      .select('id, name, name_kana, name_en, image_url', { count: 'exact' })
      .eq('browse_kind', tab)
    if (query) {
      // 名前・かな・英語表記のいずれかに部分一致(従来のブラウザ側絞り込みと同じ対象)
      const escaped = query.replace(/[%,]/g, '')
      if (escaped) {
        request = request.or(`name.ilike.%${escaped}%,name_kana.ilike.%${escaped}%,name_en.ilike.%${escaped}%`)
      }
    }
    const { data, count } = await request.order('sort_key').range(offset, offset + PAGE_SIZE - 1)
    totalCount = count ?? 0
    const rows = (data ?? []) as ArtistRow[]

    if (tab === 'artist') {
      artists = rows
    } else {
      // メンバーの所属バンド名は、このページに出る60件分だけ引く
      const ids = rows.map((r) => r.id)
      const bandNamesById = new Map<string, string[]>()
      if (ids.length > 0) {
        const { data: relations } = await supabase
          .from('artist_relation')
          .select('artist_id_b, band:artist_id_a(name)')
          .eq('relation_type', 'membership')
          .in('artist_id_b', ids)
        for (const row of relations ?? []) {
          const band = Array.isArray(row.band) ? row.band[0] : row.band
          if (!band?.name || !row.artist_id_b) continue
          const list = bandNamesById.get(row.artist_id_b) ?? []
          list.push(band.name)
          bandNamesById.set(row.artist_id_b, list)
        }
      }
      members = rows.map((r) => ({ ...r, bandNames: bandNamesById.get(r.id) ?? [] }))
    }
  } else {
    const [{ data }, options] = await Promise.all([
      supabase.rpc('browse_credit_persons', {
        p_query: query || null,
        p_role: role,
        p_instrument: role === 'musician' ? instrument : 'all',
        p_limit: PAGE_SIZE,
        p_offset: offset,
      }),
      getInstrumentOptions(),
    ])
    const rows = (data ?? []) as CreditPersonRow[]
    totalCount = rows[0]?.total_count ? Number(rows[0].total_count) : 0
    credits = rows.map((r) => ({ id: r.id, name: r.name, roles: r.roles ?? [], instruments: r.instruments ?? [] }))
    instrumentOptions = options
  }

  return (
    <ArtistBrowseClient
      tab={tab}
      query={query}
      page={page}
      role={role}
      instrument={instrument}
      pageSize={PAGE_SIZE}
      totalCount={totalCount}
      artists={artists}
      members={members}
      credits={credits}
      allInstruments={instrumentOptions}
    />
  )
}
