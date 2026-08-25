import { createClient } from '@supabase/supabase-js'
import { autoImportArtistProfileFromMusicBrainz } from './utils/artistProfileImport'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: artists } = await supabase.from('artist').select('id, name').order('name')
  console.log(`artists: ${artists?.length ?? 0}`)

  let done = 0
  for (const artist of artists ?? []) {
    try {
      const result = await autoImportArtistProfileFromMusicBrainz(supabase, artist.id)
      console.log(`[${++done}/${artists!.length}] ${artist.name}: ${result}`)
    } catch (err) {
      console.error(`[${++done}/${artists!.length}] ${artist.name}: ERROR`, err)
    }
  }
  console.log('DONE')
}
main()
