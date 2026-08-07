import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { fetchArtistWithAlbums, extractCollaboratorNames, searchArtist } from '@/utils/itunes'
import { importSelectedCollaborators } from './actions'

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
      <div className="mx-auto max-w-2xl px-6 py-12">
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
      try {
        const candidates = await searchArtist(name)
        const filtered = candidates.filter((c) => !existingIds.has(String(c.artistId)))
        return { name, candidates: filtered }
      } catch {
        return { name, candidates: [] }
      }
    })
  )

  const withCandidates = results.filter((r) => r.candidates.length > 0)
  const notFoundNames = results.filter((r) => r.candidates.length === 0).map((r) => r.name)

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
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
          <button
            type="submit"
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
          >
            選択したアーティストを登録する
          </button>
        </form>
      )}

      {notFoundNames.length > 0 && (
        <p className="mt-8 text-xs text-white/40">見つからなかった名前: {notFoundNames.join('、')}</p>
      )}
    </div>
  )
}
