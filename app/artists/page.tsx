import { createClient } from '@/utils/Supabase/server'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  const { data } = await supabase.from('artist').select('id, name, name_kana, name_en, image_url')

  const artists = (data ?? []).sort((a, b) =>
    (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja')
  )

  return <ArtistBrowseClient artists={artists} />
}
