import type { SupabaseClient } from '@supabase/supabase-js'
import type { ArtistTimelineInput } from '@/utils/artistTimeline'

type MediaProgramEmbed =
  | { program_name: string | null; media: { name: string } | { name: string }[] | null }
  | { program_name: string | null; media: { name: string } | { name: string }[] | null }[]
  | null

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function mediaLabel(program: MediaProgramEmbed): { mediaName: string | null; programName: string | null } {
  const p = firstOf(program)
  const media = p ? firstOf(p.media) : null
  return { mediaName: media?.name ?? null, programName: p?.program_name ?? null }
}

/** radio_rotation(パワープレイ等のメディア選出)は対象がtrack_id/album_id/artist_idの
 * いずれか1つだけ(DBのCHECK制約 chk_radio_rotation_single_target)なので、3方向から
 * 該当行を集めて1本のリストにまとめる。トラック起点はトラック名、アルバム起点は
 * アルバム名、アーティスト直接指定はnoteをタイトル代わりに使う。 */
export async function fetchArtistMediaSelections(
  supabase: SupabaseClient,
  artistId: string
): Promise<ArtistTimelineInput['mediaSelections']> {
  const [byTrack, byAlbum, byArtist] = await Promise.all([
    supabase
      .from('radio_rotation')
      .select(
        'id, period_start_date, media_program:media_program_id(program_name, media:media_id(name)), track:track_id!inner(title, artist_id)'
      )
      .eq('track.artist_id', artistId),
    supabase
      .from('radio_rotation')
      .select(
        'id, period_start_date, media_program:media_program_id(program_name, media:media_id(name)), album:album_id!inner(title, artist_id)'
      )
      .eq('album.artist_id', artistId),
    supabase
      .from('radio_rotation')
      .select('id, period_start_date, note, media_program:media_program_id(program_name, media:media_id(name))')
      .eq('artist_id', artistId),
  ])

  const entries: ArtistTimelineInput['mediaSelections'] = []

  for (const row of byTrack.data ?? []) {
    const track = firstOf(row.track)
    entries.push({
      id: row.id,
      date: row.period_start_date,
      trackTitle: track?.title ?? null,
      ...mediaLabel(row.media_program),
    })
  }
  for (const row of byAlbum.data ?? []) {
    const album = firstOf(row.album)
    entries.push({
      id: row.id,
      date: row.period_start_date,
      trackTitle: album?.title ?? null,
      ...mediaLabel(row.media_program),
    })
  }
  for (const row of byArtist.data ?? []) {
    entries.push({
      id: row.id,
      date: row.period_start_date,
      trackTitle: row.note ?? null,
      ...mediaLabel(row.media_program),
    })
  }

  return entries
}
