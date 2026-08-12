import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistWithAlbums, extractCollaboratorNames, searchArtist } from '@/utils/itunes'
import { importSelectedCollaborators } from './actions'
import SubmitButton from './SubmitButton'

export default async function CollaboratorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { id } = await params
  const { success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id')
    .eq('id', id)
    .single()

  if (error || !artist) {
    notFound()
  }

  if (!artist.apple_music_artist_id) {
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-12">
        <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
          ← {artist.name} の編集に戻る
        </Link>
        <p className="mt-8 text-sm text-white/40">Apple Music IDが未設定です。</p>
      </div>
    )
  }

  const { albums } = await fetchArtistWithAlbums(artist.apple_music_artist_id)
  const names = extractCollaboratorNames(artist.name, albums)

  const { data: existingArtists } = await supabase.from('artist').select('apple_music_artist_id')
  const existingIds = new Set((existingArtists ?? []).map((a) => a.apple_music_artist_id))

  const results = await Promise.all(
    names.map(async (name) => {
      let rawCandidates
      try {
        rawCandidates = await searchArtist(name)
      } catch (err) {
        console.error(`コラボアーティスト候補の検索に失敗しました (${name}):`, err)
        return { name, candidates: [], reason: 'error' as const }
      }
      if (rawCandidates.length === 0) {
        return { name, candidates: [], reason: 'none' as const }
      }
      const filtered = rawCandidates.filter((c) => !existingIds.has(String(c.artistId)))
      if (filtered.length === 0) {
        return { name, candidates: [], reason: 'already-registered' as const }
      }
      return { name, candidates: filtered, reason: 'found' as const }
    })
  )

  const withCandidates = results.filter((r) => r.reason === 'found')
  const notFoundNames = results.filter((r) => r.reason === 'none').map((r) => r.name)
  const alreadyRegisteredNames = results.filter((r) => r.reason === 'already-registered').map((r) => r.name)
  const searchFailedNames = results.filter((r) => r.reason === 'error').map((r) => r.name)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} のコラボアーティストを探す</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {names.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">連名の作品が見つかりませんでした。</p>
      ) : withCandidates.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">候補が見つかりませんでした。</p>
      ) : (
        <form action={importSelectedCollaborators} className="mt-8 space-y-6">
          <input type="hidden" name="artist_id" value={id} />
          <input type="hidden" name="candidate_count" value={withCandidates.length} />
          {withCandidates.map((result, i) => (
            <div key={result.name}>
              <p className="text-sm font-medium">{result.name}</p>
              <div className="mt-2 space-y-1.5">
                <label className="flex items-center gap-2 text-sm text-white/60">
                  <input type="radio" name={`select_${i}`} value="" defaultChecked />
                  登録しない
                </label>
                {result.candidates.map((c) => (
                  <label key={c.artistId} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={`select_${i}`} value={c.artistId} />
                    {c.artistName}
                    {c.primaryGenreName && <span className="text-xs text-white/40">({c.primaryGenreName})</span>}
                    {c.artistLinkUrl && (
                      <a
                        href={c.artistLinkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-white/40 underline hover:text-white/70"
                      >
                        Apple Musicで見る
                      </a>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <SubmitButton />
        </form>
      )}

      {notFoundNames.length > 0 && (
        <p className="mt-8 text-xs text-white/40">見つからなかった名前: {notFoundNames.join('、')}</p>
      )}
      {alreadyRegisteredNames.length > 0 && (
        <p className="mt-2 text-xs text-white/40">登録済み: {alreadyRegisteredNames.join('、')}</p>
      )}
      {searchFailedNames.length > 0 && (
        <p className="mt-2 text-xs text-white/40">検索に失敗した名前: {searchFailedNames.join('、')}</p>
      )}
    </div>
  )
}
