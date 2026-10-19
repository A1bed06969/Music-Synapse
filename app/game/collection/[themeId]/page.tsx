import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/utils/Supabase/server'
import { artworkAt } from '@/utils/artworkSize'
import { fetchThemeAlbums } from '@/utils/gameData'

const ACCENT = '#3fd0e0'
const RARE = '#ffd23f'

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ themeId: string }>
  searchParams: Promise<{ show?: string }>
}) {
  const { themeId } = await params
  const { show } = await searchParams
  const supabase = await createClient()

  const { data: theme } = await supabase.from('disc_guide').select('id, title, publisher, published_year').eq('id', themeId).maybeSingle()
  if (!theme) notFound()

  const [albums, { data: collectionRows }] = await Promise.all([
    fetchThemeAlbums(supabase, themeId),
    supabase.from('game_collection').select('album_id, source'),
  ])
  const sourceByAlbum = new Map((collectionRows ?? []).map((r) => [r.album_id as string, r.source as string]))
  const have = albums.filter((a) => sourceByAlbum.has(a.albumId)).length
  const pct = albums.length > 0 ? Math.round((have / albums.length) * 100) : 0

  const filter = show === 'have' || show === 'missing' ? show : 'all'
  // 「すべて」は入手済みを先頭に(未入手の「?」に埋もれないように)。それぞれの中はガイドの並びのまま
  const visible = albums
    .filter((a) => (filter === 'all' ? true : filter === 'have' ? sourceByAlbum.has(a.albumId) : !sourceByAlbum.has(a.albumId)))
    .sort((a, b) => Number(sourceByAlbum.has(b.albumId)) - Number(sourceByAlbum.has(a.albumId)))
  const tabs = [
    { key: 'all', label: 'すべて', href: `/game/collection/${themeId}` },
    { key: 'have', label: '入手済み', href: `/game/collection/${themeId}?show=have` },
    { key: 'missing', label: '未入手', href: `/game/collection/${themeId}?show=missing` },
  ]

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <Link href="/game" className="text-xs text-white/40 hover:text-white/70">
        ← テーマ選択
      </Link>
      <p className="mt-3 text-[11px] font-bold tracking-[0.2em]" style={{ color: ACCENT }}>
        COLLECTION
      </p>
      <h1 className="mt-1 text-lg font-black leading-tight">{theme.title}</h1>

      <div className="mt-3 flex items-center gap-3">
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: ACCENT }} />
        </span>
        <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: ACCENT }}>
          {have}/{albums.length}（{pct}%）
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <nav aria-label="表示の絞り込み" className="flex gap-2">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              scroll={false}
              aria-current={t.key === filter ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition ${t.key === filter ? 'border-white bg-white text-black' : 'border-white/15 text-white/70 hover:text-white'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Link href={`/game/play/${themeId}`} className="rounded-md px-3 py-1.5 text-xs font-black text-black" style={{ backgroundColor: ACCENT }}>
          あそぶ
        </Link>
      </div>

      <ul className="mt-4 grid grid-cols-3 gap-2.5">
        {visible.map((a) => {
          const source = sourceByAlbum.get(a.albumId)
          if (!source) {
            // 未入手はジャケットを見せない(何が入るかを楽しみにしておく)
            return (
              <li key={a.albumId}>
                <span className="flex aspect-square items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-lg text-white/15">?</span>
              </li>
            )
          }
          return (
            <li key={a.albumId}>
              <Link href={`/albums/${a.albumId}`} className="group block">
                <span className="relative block aspect-square overflow-hidden rounded-md bg-white/5" style={{ boxShadow: source === 'rare' ? `0 0 0 2px ${RARE}` : undefined }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={artworkAt(a.jacketUrl, 300) ?? a.jacketUrl} alt={a.title} loading="lazy" decoding="async" className="h-full w-full object-cover transition group-hover:scale-105" />
                  {source === 'rare' && (
                    <span className="absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-black text-black" style={{ backgroundColor: RARE }}>
                      RARE
                    </span>
                  )}
                </span>
                <span className="mt-1 block truncate text-[11px] font-bold">{a.title}</span>
                <span className="block truncate text-[10px] text-white/50">{a.artistName}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      {visible.length === 0 && <p className="mt-6 text-center text-sm text-white/40">該当するジャケットはありません。</p>}
    </div>
  )
}
