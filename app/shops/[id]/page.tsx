import Link from 'next/link'
import { notFound } from 'next/navigation'
import { siX, siInstagram } from 'simple-icons'
import { createClient } from '@/utils/Supabase/server'

export default async function ShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: shop, error } = await supabase
    .from('recordshop')
    .select('id, name, address, country, prefecture_or_state, city, hours, official_site_url, sns_x_url, sns_instagram_url')
    .eq('id', id)
    .single()

  if (error || !shop) {
    notFound()
  }

  const locationLine = [shop.country, shop.prefecture_or_state, shop.city].filter(Boolean).join(' / ')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/map" className="text-xs text-white/40 hover:text-white/70">
        ← 地図に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">{shop.name}</h1>

      <div className="mt-4 space-y-1 text-sm text-white/60">
        {locationLine && <p>{locationLine}</p>}
        {shop.address && <p>{shop.address}</p>}
        {shop.hours && <p>営業時間: {shop.hours}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {shop.official_site_url && (
          <a
            href={shop.official_site_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:text-white"
          >
            公式サイト →
          </a>
        )}
        {shop.sns_x_url && (
          <a
            href={shop.sns_x_url}
            target="_blank"
            rel="noreferrer"
            title="X"
            aria-label="X"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
            style={{ backgroundColor: `#${siX.hex}` }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff">
              <path d={siX.path} />
            </svg>
          </a>
        )}
        {shop.sns_instagram_url && (
          <a
            href={shop.sns_instagram_url}
            target="_blank"
            rel="noreferrer"
            title="Instagram"
            aria-label="Instagram"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
            style={{ backgroundColor: `#${siInstagram.hex}` }}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff">
              <path d={siInstagram.path} />
            </svg>
          </a>
        )}
      </div>
    </div>
  )
}
