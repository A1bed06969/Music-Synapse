import { createClient } from '@/utils/Supabase/server'

export type SiteStats = {
  artist: number
  album: number
  track: number
  event: number
  discGuide: number
  recordShop: number
  livehouse: number
}

export async function getStats(): Promise<SiteStats> {
  const supabase = await createClient()

  const [artist, album, track, event, discGuide, recordShop, livehouse] = await Promise.all([
    supabase.from('artist').select('*', { count: 'exact', head: true }),
    supabase.from('album').select('*', { count: 'exact', head: true }),
    supabase.from('track').select('*', { count: 'exact', head: true }),
    supabase.from('event').select('*', { count: 'exact', head: true }),
    supabase.from('disc_guide').select('*', { count: 'exact', head: true }),
    supabase.from('recordshop').select('*', { count: 'exact', head: true }),
    supabase.from('livehouse').select('*', { count: 'exact', head: true }),
  ])

  return {
    artist: artist.count ?? 0,
    album: album.count ?? 0,
    track: track.count ?? 0,
    event: event.count ?? 0,
    discGuide: discGuide.count ?? 0,
    recordShop: recordShop.count ?? 0,
    livehouse: livehouse.count ?? 0,
  }
}
