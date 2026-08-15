import Link from 'next/link'

const NAV_LINKS = [
  { href: '/artists', label: 'アーティスト' },
  { href: '/albums', label: 'アルバム' },
  { href: '/tracks', label: 'トラック' },
  { href: '/events', label: 'フェス&イベント' },
  { href: '/map', label: 'マップ' },
  { href: '/media', label: 'メディア' },
  { href: '/relations', label: '相関図' },
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
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-white/60">
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
      </div>
    </footer>
  )
}
