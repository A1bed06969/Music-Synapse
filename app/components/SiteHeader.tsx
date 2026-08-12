import Link from 'next/link'

const NAV_LINKS = [
  { href: '/', label: 'ホーム' },
  { href: '/search', label: '検索' },
  { href: '/relations', label: '相関図' },
  { href: '/events', label: 'フェス&イベント' },
  { href: '/map', label: 'マップ' },
  { href: '/media', label: 'メディア' },
  { href: '/admin/import', label: 'iTunes登録' },
  { href: '/admin/data', label: '手動データ' },
]

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-white">🧠 Music Synapse</span>
          <span className="hidden text-xs text-white/40 sm:inline">ミュージック・シナプス</span>
        </Link>
        <nav className="flex gap-5 text-sm text-white/70">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
