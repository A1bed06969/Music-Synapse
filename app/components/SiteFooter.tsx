import Link from 'next/link'
import { HUB_CONTENTS } from './hub/hubContents'
import { anton } from './detail/displayFont'

const NAV_LINKS = [
  { href: '/artists', label: 'アーティスト' },
  { href: '/albums', label: 'アルバム' },
  { href: '/tracks', label: 'トラック' },
  { href: '/media', label: 'メディア' },
  { href: '/search', label: '検索' },
]

const DATA_SOURCES = ['MusicBrainz', 'Wikidata', 'Apple Music', 'Spotify', 'OpenStreetMap']

export default function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#0a0a0a]">
      <div className="mx-auto max-w-[1600px] px-6 py-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="Music Synapse" className="h-9 w-9 object-contain" />
            <p className="mt-3 text-sm font-semibold text-white">Music Synapse</p>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/40">音楽をつなぎ、新しい発見へ。</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/40">サイトマップ</p>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              {HUB_CONTENTS.map((c) => (
                <li key={c.key}>
                  <Link href={c.href} className="flex items-center gap-2.5 transition hover:text-white">
                    <span className={`${anton.className} w-6 text-base leading-none`} style={{ color: c.color }}>
                      {c.number}
                    </span>
                    <span className="text-xs font-bold tracking-wide">{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-sm text-white/60">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/40">データソース・協力</p>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              {DATA_SOURCES.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Music Synapse. All rights reserved.</p>
          <p>本サイトは各種音楽配信サービスのアフィリエイトプログラムを利用している場合があります。</p>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-white/30">
          ジャケット画像・試聴音源は、Apple Music / iTunes Store から提供されたものを、その作品の紹介のために表示しています(provided courtesy of iTunes)。各作品の「Apple Music」リンクから、配信ページで聴けます。
          Apple Music、iTunes は Apple Inc. の商標です。ジャケット画像の権利は、各権利者に帰属します。
        </p>
      </div>
    </footer>
  )
}
