import { createClient } from '@supabase/supabase-js'
import { autoImportFromMusicBrainz } from './utils/creditImport'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, serviceKey)

  const PAGE = 1000
  const albums: { id: string; title: string; artist_id: string; artist_name: string }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('album')
      .select('id, title, artist_id, artist:artist_id(name)')
      .is('label_id', null)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error(error)
      return
    }
    if (!data || data.length === 0) break
    for (const row of data) {
      const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
      albums.push({ id: row.id, title: row.title, artist_id: row.artist_id, artist_name: artist?.name ?? '' })
    }
    if (data.length < PAGE) break
  }
  console.log(`albums missing label: ${albums.length}`)

  let done = 0
  for (const album of albums) {
    try {
      const result = await autoImportFromMusicBrainz(supabase, album.artist_id, album.artist_name, {
        id: album.id,
        title: album.title,
      })
      done++
      if (done % 20 === 0 || result.includes('レーベル')) {
        console.log(`[${done}/${albums.length}] ${album.artist_name} - ${album.title}: ${result}`)
      }
    } catch (err) {
      done++
      console.error(`[${done}/${albums.length}] ${album.artist_name} - ${album.title}: ERROR`, err)
    }
  }
  console.log('DONE')
}
main()
