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
