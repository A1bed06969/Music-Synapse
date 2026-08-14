import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { geocodeWithFallback } from '@/utils/nominatim'
import { importRecordShop } from './actions'
import SubmitButton from './SubmitButton'

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass = 'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; address?: string; url?: string; hours?: string; success?: string; error?: string }>
}) {
  const { name, address, url, hours, success, error: errorMessage } = await searchParams
  const supabase = await createClient()

  const { data: shops } = await supabase
    .from('recordshop')
    .select('id, name, address, city, prefecture_or_state')
    .order('name')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">レコードショップの登録</h1>

      {success && (
        <div className="mt-4 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{errorMessage}</div>
      )}

      {name && address ? (
        <ShopCandidates name={name} address={address} url={url ?? ''} hours={hours ?? ''} />
      ) : (
        <form action="/admin/data/shops" className="mt-8 space-y-2">
          <input name="name" placeholder="店名(例: バナナレコード 大阪梅田店)" required className={inputClass} />
          <input name="address" placeholder="住所" required className={inputClass} />
          <input name="url" placeholder="公式サイトURL(任意)" className={inputClass} />
          <input name="hours" placeholder="営業時間(任意。例: 11:00〜20:00)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            住所から座標を検索
          </button>
        </form>
      )}

      {shops && shops.length > 0 && (
        <div className="mt-10 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white/70">登録済み店舗</h2>
          <ul className="mt-3 space-y-1 text-sm text-white/60">
            {shops.map((s) => (
              <li key={s.id}>
                <Link href={`/shops/${s.id}`} className="hover:text-white">
                  {s.name}
                </Link>
                <span className="text-white/30">
                  {' '}
                  ({[s.prefecture_or_state, s.city].filter(Boolean).join(' ') || s.address || '住所不明'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function ShopCandidates({
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
  let isApproximate = false
  try {
    const geocoded = await geocodeWithFallback(address)
    results = geocoded.results
    isApproximate = geocoded.isApproximate
  } catch (err) {
    console.error('Nominatim検索に失敗しました:', err)
    return <p className="mt-8 text-sm text-white/40">検索に失敗しました。</p>
  }

  if (results.length === 0) {
    return (
      <p className="mt-8 text-sm text-white/40">
        該当する候補が見つかりませんでした。詳細な住所でヒットしない場合は、「東京都渋谷区」のように都道府県・市区町村名だけで再検索すると見つかることがあります。
      </p>
    )
  }

  return (
    <div className="mt-8">
      <Link href="/admin/data/shops" prefetch={false} className="text-xs text-white/40 hover:text-white/70">
        ← 入力し直す
      </Link>

      {isApproximate && (
        <p className="mt-4 text-xs text-white/40">
          入力された詳細住所は見つからなかったため、周辺エリアの代表地点を表示しています。
        </p>
      )}

      <div className="mt-4 space-y-2">
        {results.map((r, i) => (
          <form
            key={i}
            action={importRecordShop}
            className="flex items-center justify-between gap-3 rounded-md border border-white/15 px-4 py-3 text-sm"
          >
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="address" value={address} />
            <input type="hidden" name="official_site_url" value={url} />
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
