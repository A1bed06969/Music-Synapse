import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { geocodeVenue } from '@/utils/nominatim'
import { importLivehouse } from './actions'
import SubmitButton from './SubmitButton'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass = 'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function LivehousesPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; address?: string; url?: string; hours?: string; success?: string; error?: string }>
}) {
  const { name, address, url, hours, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: livehouses } = await supabase
    .from('livehouse')
    .select('id, name, address, city, prefecture_or_state')
    .order('name')

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">ライブハウスの登録</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {name && address ? (
        <LivehouseCandidates name={name} address={address} url={url ?? ''} hours={hours ?? ''} />
      ) : (
        <form action="/admin/data/livehouses" className="mt-8 space-y-2">
          <input name="name" placeholder="ライブハウス名(例: 渋谷WWW)" required className={inputClass} />
          <input name="address" placeholder="住所" required className={inputClass} />
          <input name="url" placeholder="公式サイトURL(任意)" className={inputClass} />
          <input name="hours" placeholder="営業時間(任意)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            住所から座標を検索
          </button>
        </form>
      )}

      {livehouses && livehouses.length > 0 && (
        <div className="mt-10 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white/70">登録済みライブハウス</h2>
          <ul className="mt-3 space-y-1 text-sm text-white/60">
            {livehouses.map((l) => (
              <li key={l.id}>
                <Link href={`/livehouses/${l.id}`} className="hover:text-white">
                  {l.name}
                </Link>
                <span className="text-white/30">
                  {' '}
                  ({[l.prefecture_or_state, l.city].filter(Boolean).join(' ') || l.address || '住所不明'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function LivehouseCandidates({
  name,
  address,
  url,
  hours,
}: {
  name: string
  address: string
  url: string
  hours: string
}) {
  let results
  try {
    results = await geocodeVenue(address)
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return <p className="mt-8 text-sm text-white/40">該当する候補が見つかりませんでした。</p>
  }

  return (
    <div className="mt-8">
      <Link href="/admin/data/livehouses" prefetch={false} className="text-xs text-white/40 hover:text-white/70">
        ← 入力し直す
      </Link>

      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <form
            key={i}
            action={importLivehouse}
            className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
          >
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="address" value={address} />
            <input type="hidden" name="url" value={url} />
            <input type="hidden" name="hours" value={hours} />
            <input type="hidden" name="country" value={r.country ?? ''} />
            <input type="hidden" name="prefecture_or_state" value={r.prefectureOrState ?? ''} />
            <input type="hidden" name="city" value={r.city ?? ''} />
            <input type="hidden" name="latitude" value={r.latitude} />
            <input type="hidden" name="longitude" value={r.longitude} />
            <span>{r.displayName}</span>
            <SubmitButton />
          </form>
        ))}
      </div>
    </div>
  )
}
