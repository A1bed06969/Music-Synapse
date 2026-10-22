// utils/samplingData.ts
//
// Sampling & Mash-Up Anatomy(11)の表示用データ。track_relation(曲どうしの関係)から、1曲を中心に集める。
import type { SupabaseClient } from '@supabase/supabase-js'

export type AnatomyTrack = {
  id: string
  title: string
  artistId: string | null
  artistName: string | null
  jacket: string | null
  year: number | null
}
export type AnatomyLink = { track: AnatomyTrack; type: 'remix' | 'edit' | 'bootleg' | 'mashup' | 'sample'; note: string | null }
export type AnatomyData = {
  track: AnatomyTrack
  /** この曲の元の曲(この曲が、リミックス・エディットなどの版のとき) */
  originals: AnatomyLink[]
  /** この曲から生まれた版 */
  versions: AnatomyLink[]
  /** この曲が、元が特定できないマッシュアップ・ブートレッグのとき */
  isMashup: boolean
  /** 元ネタが分かっているが、カタログに無い曲(名前だけ) */
  externalOriginals: { title: string; artist: string | null; note: string | null; type: string }[]
  /** 元の曲が同じ、ほかの版(この曲が版のとき) */
  siblings: AnatomyLink[]
}

type Row = {
  id: string
  title: string
  artist: { id: string; name: string } | { id: string; name: string }[] | null
  album: { jacket_url: string | null; release_date: string | null } | { jacket_url: string | null; release_date: string | null }[] | null
}
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const TRACK_SELECT = 'id, title, artist:artist_id(id, name), album:album_id(jacket_url, release_date)'

function toTrack(r: Row): AnatomyTrack {
  const a = one(r.artist)
  const al = one(r.album)
  return { id: r.id, title: r.title, artistId: a?.id ?? null, artistName: a?.name ?? null, jacket: al?.jacket_url ?? null, year: al?.release_date ? Number(al.release_date.slice(0, 4)) : null }
}

/** 同じ版が複数のアルバム(ベスト盤・配信盤など)に入っているときは、1つにまとめる(最も古い年のものを残す) */
function dedupe(links: AnatomyLink[]): AnatomyLink[] {
  const seen = new Map<string, AnatomyLink>()
  for (const l of links) {
    const k = `${l.track.artistId ?? ''}|${l.type}|${l.track.title.normalize('NFKC').toLowerCase().replace(/\s+/g, '')}`
    const prev = seen.get(k)
    if (!prev || (l.track.year ?? 9999) < (prev.track.year ?? 9999)) seen.set(k, l)
  }
  return Array.from(seen.values()).sort((a, b) => (b.track.year ?? 0) - (a.track.year ?? 0))
}

export async function fetchAnatomy(supabase: SupabaseClient, trackId: string): Promise<AnatomyData | null> {
  const { data: t } = await supabase.from('track').select(TRACK_SELECT).eq('id', trackId).maybeSingle()
  if (!t) return null
  const track = toTrack(t as unknown as Row)

  const [asDerived, asOriginal] = await Promise.all([
    supabase.from('track_relation').select(`relation_type, note, original:related_track_id(${TRACK_SELECT})`).eq('track_id', trackId).not('related_track_id', 'is', null),
    supabase.from('track_relation').select(`relation_type, note, derived:track_id(${TRACK_SELECT})`).eq('related_track_id', trackId).limit(200),
  ])
  const ext = await supabase.from('track_relation').select('relation_type, note, original_title, original_artist').eq('track_id', trackId).is('related_track_id', null).not('original_title', 'is', null).limit(30)
  const mash = await supabase.from('track_relation').select('id').eq('track_id', trackId).eq('relation_type', 'mashup').is('related_track_id', null).limit(1)

  type RelO = { relation_type: AnatomyLink['type']; note: string | null; original: Row | Row[] | null }
  type RelD = { relation_type: AnatomyLink['type']; note: string | null; derived: Row | Row[] | null }
  const originals: AnatomyLink[] = ((asDerived.data ?? []) as unknown as RelO[]).flatMap((r) => {
    const o = one(r.original)
    return o ? [{ track: toTrack(o), type: r.relation_type, note: r.note }] : []
  })
  const versions: AnatomyLink[] = ((asOriginal.data ?? []) as unknown as RelD[]).flatMap((r) => {
    const d = one(r.derived)
    return d ? [{ track: toTrack(d), type: r.relation_type, note: r.note }] : []
  })

  // この曲が版のとき、同じ元の曲から生まれたほかの版
  let siblings: AnatomyLink[] = []
  if (originals.length > 0) {
    const { data } = await supabase
      .from('track_relation')
      .select(`relation_type, note, derived:track_id(${TRACK_SELECT})`)
      .eq('related_track_id', originals[0].track.id)
      .neq('track_id', trackId)
      .limit(60)
    siblings = ((data ?? []) as unknown as RelD[]).flatMap((r) => {
      const d = one(r.derived)
      return d ? [{ track: toTrack(d), type: r.relation_type, note: r.note }] : []
    })
  }
  const externalOriginals = ((ext.data ?? []) as { relation_type: string; note: string | null; original_title: string; original_artist: string | null }[]).map((r) => ({
    title: r.original_title,
    artist: r.original_artist,
    note: r.note,
    type: r.relation_type,
  }))
  return { track, originals, versions: dedupe(versions), isMashup: (mash.data ?? []).length > 0, siblings: dedupe(siblings), externalOriginals }
}

export const RELATION_LABEL: Record<string, string> = { remix: 'リミックス', edit: 'エディット', bootleg: 'ブートレッグ', mashup: 'マッシュアップ', sample: 'サンプリング' }

export type SamplingPair = { derived: AnatomyTrack; original: AnatomyTrack; note: string | null }

/** サンプリングで結ばれた曲のペア(新しい曲 → 元ネタ)。seed(日付など)で、毎日違う顔ぶれを選ぶ */
export async function fetchSamplingPairs(supabase: SupabaseClient, limit: number, seed: string): Promise<SamplingPair[]> {
  const { data } = await supabase
    .from('track_relation')
    .select(`note, derived:track_id(${TRACK_SELECT}), original:related_track_id(${TRACK_SELECT})`)
    .eq('relation_type', 'sample')
    .not('related_track_id', 'is', null)
    .limit(400)
  type R = { note: string | null; derived: Row | Row[] | null; original: Row | Row[] | null }
  const pairs = ((data ?? []) as unknown as R[]).flatMap((r) => {
    const d = one(r.derived)
    const o = one(r.original)
    return d && o ? [{ derived: toTrack(d), original: toTrack(o), note: r.note }] : []
  })
  // ジャケットのあるものを優先し、seed で並びを決める(同じ日は同じ並び)
  const hash = (s: string) => {
    let h = 2166136261
    for (const ch of s + seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    return h >>> 0
  }
  return pairs
    .filter((p) => p.derived.jacket && p.original.jacket)
    .sort((a, b) => hash(a.derived.id + a.original.id) - hash(b.derived.id + b.original.id))
    .slice(0, limit)
}
