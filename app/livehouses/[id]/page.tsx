import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import BackLink from '@/app/components/navigation/BackLink'

export default async function LivehouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: livehouse, error } = await supabase
    .from('livehouse')
    .select('id, name, address, country, prefecture_or_state, city, hours, url')
    .eq('id', id)
    .single()

  if (error || !livehouse) {
    notFound()
  }

  const locationLine = [livehouse.country, livehouse.prefecture_or_state, livehouse.city]
    .filter(Boolean)
    .join(' / ')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <BackLink fallbackHref="/map" fallbackLabel="地図に戻る" />

      <h1 className="mt-4 text-2xl font-bold">{livehouse.name}</h1>

      <div className="mt-4 space-y-1 text-sm text-white/60">
        {locationLine && <p>{locationLine}</p>}
        {livehouse.address && <p>{livehouse.address}</p>}
        {livehouse.hours && <p>営業時間: {livehouse.hours}</p>}
      </div>

      {livehouse.url && (
        <a
          href={livehouse.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:text-white"
        >
          公式サイト →
        </a>
      )}
    </div>
  )
}
