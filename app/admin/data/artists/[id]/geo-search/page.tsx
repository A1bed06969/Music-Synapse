import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { searchWikidataEntity, fetchOriginCoordinates } from '@/utils/wikidata'
import { geocodeWithFallback } from '@/utils/nominatim'
import { importOriginCoordinates, importOriginCoordinatesFromAddress } from './actions'
import SubmitButton from './SubmitButton'

const inputClass =
  'w-full max-w-md rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass = 'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function ArtistGeoSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ qid?: string; q?: string; success?: string; error?: string }>
}) {
  const { id } = await params
  const { qid, q, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: artist, error } = await supabase.from('artist').select('id, name').eq('id', id).single()

  if (error || !artist) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href={`/admin/data/artists/${id}/edit`} className="text-xs text-white/40 hover:text-white/70">
        ← {artist.name} の編集に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{artist.name} の座標を検索</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">Wikidataで検索</h2>
        <div className="mt-3">
          {qid ? (
            <CoordinatesPreview artistId={id} qid={qid} />
          ) : (
            <SearchResults artistId={id} artistName={artist.name} />
          )}
        </div>
      </section>

      <section className="mt-10 border-t border-white/10 pt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-white/40">
          住所・地名で検索(Wikidataに無い場合の代替)
        </h2>
        <p className="mt-2 text-xs text-white/40">
          出身地・拠点の住所や市区町村名を入力すると、その代表地点にプロットできます。
        </p>
        <div className="mt-3">
          {q ? (
            <AddressCandidates artistId={id} query={q} />
          ) : (
            <form action={`/admin/data/artists/${id}/geo-search`} className="flex flex-wrap gap-2">
              <input name="q" placeholder="例: 東京都渋谷区、大阪府大阪市" required className={inputClass} />
              <button type="submit" className={buttonClass}>
                検索
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}

async function AddressCandidates({ artistId, query }: { artistId: string; query: string }) {
  let results
  let isApproximate = false
  try {
    const geocoded = await geocodeWithFallback(query)
    results = geocoded.results
    isApproximate = geocoded.isApproximate
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="text-sm text-white/40">検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div>
      <Link
        href={`/admin/data/artists/${artistId}/geo-search`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 入力し直す
      </Link>

      {isApproximate && (
        <p className="mt-3 text-xs text-white/40">
          入力された詳細住所は見つからなかったため、周辺エリアの代表地点を表示しています。
        </p>
      )}

      <div className="mt-3 space-y-2">
        {results.map((r, i) => (
          <form
            key={i}
            action={importOriginCoordinatesFromAddress}
            className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
          >
            <input type="hidden" name="artist_id" value={artistId} />
            <input type="hidden" name="latitude" value={r.latitude} />
            <input type="hidden" name="longitude" value={r.longitude} />
            <input type="hidden" name="prefecture_or_state" value={r.prefectureOrState ?? ''} />
            <input type="hidden" name="city" value={r.city ?? ''} />
            <span>{r.displayName}</span>
            <SubmitButton />
          </form>
        ))}
      </div>
    </div>
  )
}

async function SearchResults({ artistId, artistName }: { artistId: string; artistName: string }) {
  let results
  try {
    results = await searchWikidataEntity(artistName)
  } catch (err) {
    console.error('Wikidata検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">Wikidataでの検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div className="mt-8 space-y-2">
      {results.map((r) => (
        <Link
          key={r.qid}
          href={`/admin/data/artists/${artistId}/geo-search?qid=${r.qid}`}
          prefetch={false}
          className="block rounded-md border border-white/15 px-4 py-3 text-sm hover:bg-white/5"
        >
          <span className="font-medium">{r.label}</span>
          {r.description && <span className="ml-2 text-xs text-white/40">{r.description}</span>}
        </Link>
      ))}
    </div>
  )
}

async function CoordinatesPreview({ artistId, qid }: { artistId: string; qid: string }) {
  let coords
  try {
    coords = await fetchOriginCoordinates(qid)
  } catch (err) {
    console.error('Wikidata座標取得に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">Wikidataからの取得に失敗しました。</p>
  }

  if (!coords) {
    return <p className="mt-8 text-sm text-white/40">この候補には座標データがありませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link
        href={`/admin/data/artists/${artistId}/geo-search`}
        prefetch={false}
        className="text-xs text-white/40 hover:text-white/70"
      >
        ← 候補一覧に戻る
      </Link>

      <p className="mt-4 text-sm text-white/70">
        {coords.placeLabel}({coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)})
      </p>

      <form action={importOriginCoordinates} className="mt-6">
        <input type="hidden" name="artist_id" value={artistId} />
        <input type="hidden" name="latitude" value={coords.latitude} />
        <input type="hidden" name="longitude" value={coords.longitude} />
        <SubmitButton />
      </form>
    </div>
  )
}
