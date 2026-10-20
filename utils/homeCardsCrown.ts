// TOPページの⑦Crown The Winners・⑧Genre Roots Tapestry・⑨Connect The Music Makers のバナー用データ。
// TOPは毎回描画されるので、どれも件数を絞った軽い問い合わせにしている。
import type { createClient } from '@/utils/Supabase/server'
import { getDescendantGenreIds, type LineageEdge } from '@/utils/genreHistory'

type Supabase = Awaited<ReturnType<typeof createClient>>

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// ---------- ⑦ Crown The Winners ----------

export type CrownCard = { id: string; artistId: string; artistName: string; imageUrl: string; awardName: string; category: string; year: number }
export type CrownData = { winners: CrownCard[]; winnerTotal: number; awardTotal: number }

/** 受賞の新しい順(同じ年はアワード名順)に、アーティスト画像のある受賞者を同じアーティストが重ならないよう取る */
export async function fetchCrownWinners(supabase: Supabase, count = 6): Promise<CrownData> {
  const [{ data: rows }, { count: winnerTotal }, { count: awardTotal }] = await Promise.all([
    supabase
      .from('award_entry')
      .select('id, year, category, award:award_id(name), artist:artist_id(id, name, image_url)')
      .eq('result', 'winner')
      .not('artist_id', 'is', null)
      .order('year', { ascending: false })
      .limit(300),
    supabase.from('award_entry').select('id', { count: 'exact', head: true }).eq('result', 'winner'),
    supabase.from('award').select('id', { count: 'exact', head: true }),
  ])

  const winners: CrownCard[] = []
  const seen = new Set<string>()
  for (const r of rows ?? []) {
    const artist = firstOf(r.artist)
    const award = firstOf(r.award)
    if (!artist?.image_url || !award || seen.has(artist.id) || r.year == null) continue
    seen.add(artist.id)
    winners.push({ id: r.id, artistId: artist.id, artistName: artist.name, imageUrl: artist.image_url, awardName: award.name, category: r.category ?? '', year: r.year })
    if (winners.length >= count) break
  }
  return { winners, winnerTotal: winnerTotal ?? 0, awardTotal: awardTotal ?? 0 }
}

// ---------- ⑧ Genre Roots Tapestry ----------

export type GenreRootCard = { id: string; name: string; imageUrl: string | null; subCount: number; label: string | null }
export type GenreRootsData = { roots: GenreRootCard[]; genreTotal: number }

/** 系譜の根(親を持たず子を持つジャンル)を、サブジャンルが多い順に並べる */
export async function fetchGenreRoots(supabase: Supabase, count = 4): Promise<GenreRootsData> {
  const { data: lineageRows } = await supabase.from('genre_lineage').select('parent_genre_id, child_genre_id, relation_type')
  const edges: LineageEdge[] = (lineageRows ?? []).map((r) => ({
    parentGenreId: r.parent_genre_id,
    childGenreId: r.child_genre_id,
    relationType: (r.relation_type as LineageEdge['relationType']) ?? 'derivation',
  }))
  const childIds = new Set(edges.map((e) => e.childGenreId))
  const rootIds = [...new Set(edges.map((e) => e.parentGenreId))].filter((id) => !childIds.has(id))
  if (rootIds.length === 0) return { roots: [], genreTotal: 0 }

  const descendants = new Map(rootIds.map((id) => [id, getDescendantGenreIds(id, edges)]))
  const allIds = [...new Set([...descendants.values()].flat())]

  const [{ data: genres }, { data: highlights }] = await Promise.all([
    supabase.from('genre').select('id, name, origin_year_label').in('id', rootIds),
    supabase.from('genre_highlight').select('genre_id, artist:artist_id(image_url), album:album_id(jacket_url)').in('genre_id', allIds).order('id'),
  ])
  const imageByGenre = new Map<string, string>()
  for (const h of highlights ?? []) {
    if (imageByGenre.has(h.genre_id)) continue
    const url = firstOf(h.artist)?.image_url ?? firstOf(h.album)?.jacket_url ?? null
    if (url) imageByGenre.set(h.genre_id, url)
  }

  const roots = (genres ?? [])
    .map((g) => {
      const ids = descendants.get(g.id) ?? []
      return {
        id: g.id,
        name: g.name,
        imageUrl: ids.map((i) => imageByGenre.get(i)).find((u) => u !== undefined) ?? null,
        subCount: Math.max(ids.length - 1, 0),
        label: g.origin_year_label,
      }
    })
    .sort((a, b) => b.subCount - a.subCount)
    .slice(0, count)
  return { roots, genreTotal: allIds.length }
}

// ---------- ⑨ Connect The Music Makers ----------

export type ConnectPair = { id: number; aId: string; aName: string; aImage: string | null; bId: string; bName: string; bImage: string | null; label: string }
export type ConnectData = { pairs: ConnectPair[]; relationTotal: number }

/** アーティスト同士のつながり(クレジット情報が集まるまでは artist_relation だけ) */
export async function fetchConnectPairs(supabase: Supabase, count = 4): Promise<ConnectData> {
  const [{ data: rows }, { count: relationTotal }] = await Promise.all([
    supabase
      .from('artist_relation')
      .select('id, relation_type, description, a:artist_id_a(id, name, image_url), b:artist_id_b(id, name, image_url)')
      .order('id', { ascending: false })
      .limit(60),
    supabase.from('artist_relation').select('id', { count: 'exact', head: true }),
  ])
  const pairs: ConnectPair[] = []
  for (const r of rows ?? []) {
    const a = firstOf(r.a)
    const b = firstOf(r.b)
    if (!a || !b || (!a.image_url && !b.image_url)) continue
    pairs.push({ id: r.id, aId: a.id, aName: a.name, aImage: a.image_url, bId: b.id, bName: b.name, bImage: b.image_url, label: r.description ?? r.relation_type })
    if (pairs.length >= count) break
  }
  return { pairs, relationTotal: relationTotal ?? 0 }
}
