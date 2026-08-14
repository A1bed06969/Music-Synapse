'use client'

import Link from 'next/link'
import { useState } from 'react'
import Logo from './Logo'

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
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMenuOpen(false)}>
          <Logo className="h-7 w-7 shrink-0" />
          <span className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-white">Music Synapse</span>
            <span className="hidden text-xs text-white/40 sm:inline">ミュージック・シナプス</span>
          </span>
        </Link>

        <nav className="hidden gap-5 text-sm text-white/70 sm:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="メニュー"
          className="flex h-8 w-8 flex-col items-center justify-center gap-1.5 sm:hidden"
        >
          <span
            className={`block h-0.5 w-5 bg-white/80 transition-transform duration-300 ${menuOpen ? 'translate-y-2 rotate-45' : ''}`}
          />
          <span className={`block h-0.5 w-5 bg-white/80 transition-opacity duration-300 ${menuOpen ? 'opacity-0' : ''}`} />
          <span
            className={`block h-0.5 w-5 bg-white/80 transition-transform duration-300 ${menuOpen ? '-translate-y-2 -rotate-45' : ''}`}
          />
        </button>
      </div>

      <nav
        className={`overflow-hidden transition-[max-height] duration-300 ease-in-out sm:hidden ${
          menuOpen ? 'max-h-96' : 'max-h-0'
        }`}
      >
        <div className="flex flex-col gap-1 border-t border-white/10 px-6 py-3">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}
