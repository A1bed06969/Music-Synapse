'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import SectionHeading from '@/app/components/detail/SectionHeading'
import HubShell, { HubIdentity } from '@/app/components/hub/HubShell'
import { hubContent } from '@/app/components/hub/hubContents'

type GenreRow = {
  id: string
  name: string
  origin_year: number | null
  origin_year_label: string | null
  origin_country: string | null
  isSub: boolean
  imageUrl: string | null
}

/** メインジャンルの入口。右カラム(スマホでは上部)に縦に並べる。キュレーションの企画選択と同じ見た目のカード */
function MainGenreList({ genres, color }: { genres: GenreRow[]; color: string }) {
  return (
    <div>
      <p className="mb-3 text-[11px] tracking-[0.2em] text-white/40">MAIN GENRES</p>
      <ul className="flex flex-col gap-3">
        {genres.map((genre) => (
          <li key={genre.id}>
            <Link
              href={`/genres/${genre.id}`}
              className="group flex min-w-0 gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:bg-white/[0.06]"
              style={{ ['--genre-color' as string]: color }}
            >
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-white/5">
                {genre.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={genre.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-white/20">{genre.name.slice(0, 1)}</span>
                )}
              </span>
              <span className="min-w-0 self-center">
                <span className="block truncate text-base font-bold uppercase tracking-wide">{genre.name}</span>
                {(genre.origin_year_label || genre.origin_year || genre.origin_country) && (
                  <span className="mt-1 block truncate text-xs text-white/50">
                    {[genre.origin_year_label || (genre.origin_year ? `${genre.origin_year}年` : null), genre.origin_country].filter(Boolean).join(' / ')}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GenreGrid({ genres }: { genres: GenreRow[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      {genres.map((genre) => (
        <li key={genre.id} className="border-b border-white/5 py-2.5">
          <Link href={`/genres/${genre.id}`} className="text-sm font-medium hover:opacity-70">
            {genre.name}
          </Link>
          {(genre.origin_year_label || genre.origin_year || genre.origin_country) && (
            <p className="text-xs text-white/40">
              {[genre.origin_year_label || (genre.origin_year ? `${genre.origin_year}年` : null), genre.origin_country]
                .filter(Boolean)
                .join(' / ')}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function GenreListClient({ genres }: { genres: GenreRow[] }) {
  const [query, setQuery] = useState('')

  const c = hubContent('genreRoots')
  const allMain = genres.filter((g) => !g.isSub)
  const allSub = genres.filter((g) => g.isSub)
  const q = query.trim().toLowerCase()
  // 検索なしのときは中央にサブジャンル、検索中はメイン・サブをまとめて絞り込んだ結果を出す
  const shown = q ? genres.filter((g) => g.name.toLowerCase().includes(q)) : allSub

  const stats = [
    { label: 'メインジャンル', value: allMain.length },
    { label: 'サブジャンル', value: allSub.length },
  ]
  const description = (
    <p className="text-xs leading-relaxed text-white/50">
      ジャンルを選ぶと、発祥・サブジャンル・代表アーティストを時系列で並べた年表を見られます。メインジャンルから入るか、検索・サブジャンルから探せます。
    </p>
  )
  const mainList = allMain.length > 0 ? <MainGenreList genres={allMain} color={c.color} /> : null

  const centerContent = (
    <>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ジャンル名で絞り込み(メイン・サブ)..."
        className="w-full rounded-md border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
      />
      <p className="mt-3 text-xs text-white/40">{shown.length}件</p>
      {shown.length === 0 ? (
        <p className="mt-8 text-sm text-white/40">該当するジャンルが見つかりませんでした。</p>
      ) : (
        <section className="mt-6">
          <SectionHeading number={c.number} label={q ? 'SEARCH RESULTS' : 'SUB GENRES'} color={c.color} />
          <GenreGrid genres={shown} />
        </section>
      )}
    </>
  )

  return (
    <HubShell
      hubKey="genreRoots"
      stats={stats}
      leftExtra={description}
      rightExtra={mainList}
      mobileContent={
        <>
          <HubIdentity hubKey="genreRoots" stats={stats} />
          <div className="mt-2">{description}</div>
          {mainList && <div className="mt-6">{mainList}</div>}
          <div className="mt-8">{centerContent}</div>
        </>
      }
    >
      {centerContent}
    </HubShell>
  )
}
