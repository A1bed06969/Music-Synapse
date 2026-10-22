// utils/connectGraph.ts
//
// Connect The Music Makers(09)の相関図に使う、1アーティストを中心にした「つながり」を集める。
// 第1段階で使えるのは、いまDBにあるものだけ:
//   - 共演: 曲・アルバムの参加アーティスト(track_artist / album_artist、role='featured')。
//     本人の作品に参加した人(参加)と、本人が参加した他人の作品(客演)を、相手ごとにまとめる。
//   - レーベル: artist_label
//   - 制作の関わり: artist_relation(件数は少ない)
// クレジット(作詞・作曲・編曲・プロデュース)は、集まったらここに足す(artist_credit は2026-10時点で0件)。
import type { SupabaseClient } from '@supabase/supabase-js'

export type ConnectWork = { title: string; year: number | null }
export type ConnectPartner = {
  id: string
  name: string
  image: string | null
  /** 本人の作品に、相手が参加した */
  invited: boolean
  /** 本人が、相手の作品に参加した */
  guest: boolean
  works: ConnectWork[]
}
export type ConnectLabel = { id: string; name: string; since: number | null; until: number | null }
export type ConnectRelated = { id: string; name: string; image: string | null; note: string | null }
export type ConnectCenter = {
  id: string
  name: string
  image: string | null
  sub: string
}
export type ConnectData = {
  center: ConnectCenter
  partners: ConnectPartner[]
  labels: ConnectLabel[]
  related: ConnectRelated[]
}

type ArtistRef = { id: string; name: string; image_url: string | null }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const yearOf = (d: string | null | undefined) => (d ? Number(d.slice(0, 4)) || null : null)

/** 作品名から「 - Single」「(feat. …)」などを外して、同じ作品をまとめるための名前 */
export function cleanWorkTitle(title: string): string {
  return title
    .replace(/\s+-\s+(Single|EP)$/i, '')
    .replace(/\s*[(（\[]\s*(feat\.?|ft\.?|with)\s[^)）\]]*[)）\]]/gi, '')
    .trim()
}
const workKey = (t: string) => cleanWorkTitle(t).normalize('NFKC').toLowerCase().replace(/\s+/g, '')

const ARTIST_TYPE_LABEL: Record<string, string> = { person: 'ソロ', group: 'バンド・グループ', orchestra: 'オーケストラ', choir: '合唱団' }

export async function fetchConnectData(supabase: SupabaseClient, artistId: string): Promise<ConnectData | null> {
  const { data: a } = await supabase
    .from('artist')
    .select('id, name, image_url, artist_type, origin_prefecture, hometown_country, formed_year')
    .eq('id', artistId)
    .maybeSingle()
  if (!a) return null

  const [ownTracks, guestTracks, ownAlbums, guestAlbums, labelRows, relRows] = await Promise.all([
    // 本人の曲に参加した人
    supabase
      .from('track')
      .select('title, album:album_id(release_date), track_artist!inner(artist:artist_id(id, name, image_url))')
      .eq('artist_id', artistId)
      .limit(4000),
    // 本人が参加した、他人の曲
    supabase
      .from('track_artist')
      .select('track:track_id(title, artist:artist_id(id, name, image_url), album:album_id(release_date))')
      .eq('artist_id', artistId)
      .limit(3000),
    // 本人のアルバムに名前が並ぶ人
    supabase
      .from('album')
      .select('title, release_date, album_artist!inner(artist:artist_id(id, name, image_url))')
      .eq('artist_id', artistId)
      .limit(3000),
    // 本人が名前を連ねた、他人のアルバム
    supabase
      .from('album_artist')
      .select('album:album_id(title, release_date, artist:artist_id(id, name, image_url))')
      .eq('artist_id', artistId)
      .limit(3000),
    supabase.from('artist_label').select('start_date, end_date, label:label_id(id, name)').eq('artist_id', artistId),
    supabase
      .from('artist_relation')
      .select('description, a:artist_id_a(id, name, image_url), b:artist_id_b(id, name, image_url)')
      .or(`artist_id_a.eq.${artistId},artist_id_b.eq.${artistId}`),
  ])

  const partners = new Map<string, ConnectPartner & { keys: Set<string> }>()
  function add(other: ArtistRef | null, title: string | null | undefined, release: string | null | undefined, dir: 'invited' | 'guest') {
    if (!other || other.id === artistId || !title) return
    let p = partners.get(other.id)
    if (!p) {
      p = { id: other.id, name: other.name, image: other.image_url, invited: false, guest: false, works: [], keys: new Set() }
      partners.set(other.id, p)
    }
    p[dir] = true
    const k = workKey(title)
    if (p.keys.has(k)) return
    p.keys.add(k)
    p.works.push({ title: cleanWorkTitle(title), year: yearOf(release) })
  }

  type OwnTrack = { title: string; album: unknown; track_artist: { artist: unknown }[] }
  for (const t of (ownTracks.data ?? []) as OwnTrack[]) {
    const release = (one(t.album) as { release_date?: string } | null)?.release_date
    for (const x of t.track_artist ?? []) add(one(x.artist) as ArtistRef | null, t.title, release, 'invited')
  }
  type GuestTrack = { track: unknown }
  for (const g of (guestTracks.data ?? []) as GuestTrack[]) {
    const t = one(g.track) as { title: string; artist: unknown; album: unknown } | null
    if (!t) continue
    add(one(t.artist) as ArtistRef | null, t.title, (one(t.album) as { release_date?: string } | null)?.release_date, 'guest')
  }
  type OwnAlbum = { title: string; release_date: string | null; album_artist: { artist: unknown }[] }
  for (const al of (ownAlbums.data ?? []) as OwnAlbum[]) {
    for (const x of al.album_artist ?? []) add(one(x.artist) as ArtistRef | null, al.title, al.release_date, 'invited')
  }
  type GuestAlbum = { album: unknown }
  for (const g of (guestAlbums.data ?? []) as GuestAlbum[]) {
    const al = one(g.album) as { title: string; release_date: string | null; artist: unknown } | null
    if (!al) continue
    add(one(al.artist) as ArtistRef | null, al.title, al.release_date, 'guest')
  }

  const partnerList: ConnectPartner[] = Array.from(partners.values())
    .map(({ keys: _keys, ...p }) => ({ ...p, works: [...p.works].sort((x, y) => (y.year ?? 0) - (x.year ?? 0)) }))
    .sort((x, y) => y.works.length - x.works.length || (y.works[0]?.year ?? 0) - (x.works[0]?.year ?? 0) || x.name.localeCompare(y.name, 'ja'))

  type LabelRow = { start_date: string | null; end_date: string | null; label: unknown }
  const labels: ConnectLabel[] = []
  const seenLabel = new Set<string>()
  for (const r of (labelRows.data ?? []) as LabelRow[]) {
    const l = one(r.label) as { id: string; name: string } | null
    if (!l || seenLabel.has(l.id)) continue
    seenLabel.add(l.id)
    labels.push({ id: l.id, name: l.name, since: yearOf(r.start_date), until: yearOf(r.end_date) })
  }
  labels.sort((x, y) => (y.since ?? 0) - (x.since ?? 0))

  type RelRow = { description: string | null; a: unknown; b: unknown }
  const related: ConnectRelated[] = []
  for (const r of (relRows.data ?? []) as RelRow[]) {
    const ra = one(r.a) as ArtistRef | null
    const rb = one(r.b) as ArtistRef | null
    const other = ra?.id === artistId ? rb : ra
    if (!other || other.id === artistId || partners.has(other.id)) continue
    related.push({ id: other.id, name: other.name, image: other.image_url, note: r.description })
  }

  const origin = a.origin_prefecture ?? a.hometown_country ?? null
  const sub = [ARTIST_TYPE_LABEL[a.artist_type ?? ''] ?? null, origin ? `${origin}出身` : null, a.formed_year ? `${a.formed_year}年〜` : null]
    .filter(Boolean)
    .join(' ・ ')

  return {
    center: { id: a.id, name: a.name, image: a.image_url, sub },
    partners: partnerList,
    labels,
    related,
  }
}
