import type { SupabaseClient } from '@supabase/supabase-js'
import { CREDIT_ROLE_LABEL } from '@/utils/format'

export type QuadrantPerson = { id: string; name: string; role?: string; roleLabel?: string }
export type QuadrantArtist = { id: string; name: string; imageUrl: string | null }

export type ArtistCreditQuadrants = {
  producers: QuadrantPerson[]
  credits: QuadrantPerson[]
  collaborators: QuadrantArtist[]
  musicians: QuadrantPerson[]
}

// 作詞・作曲・編曲・ミックス・マスタリング・アートワークをまとめて1象限にする
const CREDIT_QUADRANT_ROLES = ['lyricist', 'composer', 'arranger', 'mix', 'mastering', 'artwork']

/** アーティストページの相関図用に、クレジット人物(プロデューサー/制作陣/
 * サポートミュージシャン)とコラボアーティスト(artist_relationのproduction)
 * を4象限に分けて集計する。バンドメンバー(membership)は別セクションで
 * 表示済みのためここには含めない。 */
export async function buildArtistCreditQuadrants(
  supabase: SupabaseClient,
  artistId: string
): Promise<ArtistCreditQuadrants> {
  const [{ data: credits }, { data: relations }] = await Promise.all([
    supabase
      .from('artist_credit')
      .select('role, credit_person:credit_person_id(id, name)')
      .eq('artist_id', artistId)
      .in('role', ['producer', 'musician', ...CREDIT_QUADRANT_ROLES]),
    supabase
      .from('artist_relation')
      .select(
        'artist_id_a, artist_id_b, artist_a:artist_id_a(id, name, image_url), artist_b:artist_id_b(id, name, image_url)'
      )
      .eq('relation_type', 'production')
      .or(`artist_id_a.eq.${artistId},artist_id_b.eq.${artistId}`),
  ])

  const producers = new Map<string, QuadrantPerson>()
  const creditFolks = new Map<string, QuadrantPerson>()
  const musicians = new Map<string, QuadrantPerson>()

  for (const row of credits ?? []) {
    const person = Array.isArray(row.credit_person) ? row.credit_person[0] : row.credit_person
    if (!person) continue
    if (row.role === 'producer') {
      producers.set(person.id, { id: person.id, name: person.name })
    } else if (row.role === 'musician') {
      musicians.set(person.id, { id: person.id, name: person.name })
    } else if (CREDIT_QUADRANT_ROLES.includes(row.role)) {
      creditFolks.set(`${person.id}:${row.role}`, {
        id: person.id,
        name: person.name,
        role: row.role,
        roleLabel: CREDIT_ROLE_LABEL[row.role] ?? row.role,
      })
    }
  }

  const collaborators = new Map<string, QuadrantArtist>()
  for (const row of relations ?? []) {
    const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
    const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
    const other = row.artist_id_a === artistId ? b : a
    if (!other) continue
    collaborators.set(other.id, { id: other.id, name: other.name, imageUrl: other.image_url })
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ja')
  return {
    producers: Array.from(producers.values()).sort(byName),
    credits: Array.from(creditFolks.values()).sort(byName),
    collaborators: Array.from(collaborators.values()).sort(byName),
    musicians: Array.from(musicians.values()).sort(byName),
  }
}
