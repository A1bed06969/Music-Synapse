// utils/museumData.ts
//
// Art Work Museum(12)の表示用データ。いまは「ギャラリー」: 画像のあるアルバムから、毎日違う顔ぶれのジャケットを選ぶ。
import type { SupabaseClient } from '@supabase/supabase-js'

export type MuseumPiece = { id: string; title: string; artistId: string | null; artistName: string | null; jacket: string; year: number | null }

type Row = {
  album: { id: string; title: string; jacket_url: string | null; release_date: string | null; artist: { id: string; name: string } | { id: string; name: string }[] | null } | null
}
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** キュレーション・アワードに載ったアルバムのうち、ジャケット画像のあるものから、seed(日付など)で並びを決めて n 枚選ぶ */
export async function fetchGalleryPicks(supabase: SupabaseClient, n: number, seed: string): Promise<MuseumPiece[]> {
  const { data } = await supabase
    .from('ranking_entry')
    .select('album:album_id(id, title, jacket_url, release_date, artist:artist_id(id, name))')
    .not('album_id', 'is', null)
    .limit(1500)
  const seen = new Set<string>()
  const pieces: MuseumPiece[] = []
  for (const r of (data ?? []) as unknown as { album: Row['album'] | Row['album'][] }[]) {
    const a = one(r.album)
    if (!a?.jacket_url || seen.has(a.id)) continue
    seen.add(a.id)
    const ar = one(a.artist)
    pieces.push({ id: a.id, title: a.title, artistId: ar?.id ?? null, artistName: ar?.name ?? null, jacket: a.jacket_url, year: a.release_date ? Number(a.release_date.slice(0, 4)) : null })
  }
  const hash = (s: string) => {
    let h = 2166136261
    for (const ch of s + seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    return h >>> 0
  }
  return pieces.sort((a, b) => hash(a.id) - hash(b.id)).slice(0, n)
}

export type CoverCreator = { personId: string; name: string; albums: number; roles: string[] }

export async function fetchTopCreators(supabase: SupabaseClient, limit: number): Promise<CoverCreator[]> {
  const { data } = await supabase.rpc('top_cover_creators', { p_limit: limit })
  return ((data ?? []) as { person_id: string; name: string; albums: number; roles: string[] }[]).map((r) => ({ personId: r.person_id, name: r.name, albums: Number(r.albums), roles: r.roles ?? [] }))
}

export type CreatorWork = MuseumPiece & { roles: string[] }

/** 制作者(credit_person)が手がけたジャケット。同じ名前の人は同一人物として、まとめて引く */
export async function fetchCreatorWorks(supabase: SupabaseClient, personId: string): Promise<{ name: string; works: CreatorWork[] } | null> {
  const { data: p } = await supabase.from('credit_person').select('id, name').eq('id', personId).maybeSingle()
  if (!p) return null
  const { data: same } = await supabase.from('credit_person').select('id').eq('name', p.name as string).limit(50)
  const ids = (same ?? []).map((x) => x.id as string)
  const { data } = await supabase
    .from('artist_credit')
    .select('role, album:album_id(id, title, jacket_url, release_date, artist:artist_id(id, name))')
    .in('credit_person_id', ids)
    .in('role', ['artwork', 'illustrator', 'art_director', 'photographer'])
    .not('album_id', 'is', null)
    .limit(1500)
  const byAlbum = new Map<string, CreatorWork>()
  for (const r of (data ?? []) as unknown as { role: string; album: Row['album'] | Row['album'][] }[]) {
    const a = one(r.album)
    if (!a) continue
    const ex = byAlbum.get(a.id)
    if (ex) {
      if (!ex.roles.includes(r.role)) ex.roles.push(r.role)
      continue
    }
    const ar = one(a.artist)
    byAlbum.set(a.id, { id: a.id, title: a.title, artistId: ar?.id ?? null, artistName: ar?.name ?? null, jacket: a.jacket_url ?? '', year: a.release_date ? Number(a.release_date.slice(0, 4)) : null, roles: [r.role] })
  }
  return { name: p.name as string, works: Array.from(byAlbum.values()).sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999)) }
}
