import { createClient } from '@/utils/Supabase/server'
import { getMemberArtistIds } from '@/utils/artistPageKind'
import ArtistBrowseClient from './ArtistBrowseClient'

export default async function ArtistsPage() {
  const supabase = await createClient()

  const [{ data }, memberIds] = await Promise.all([
    supabase.from('artist').select('id, name, name_kana, name_en, image_url'),
    getMemberArtistIds(supabase),
  ])

  const artists = (data ?? [])
    .filter((a) => !memberIds.has(a.id))
    .sort((a, b) => (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, 'ja'))

  return <ArtistBrowseClient artists={artists} />
}
