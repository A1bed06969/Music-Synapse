'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import type { SiteStats } from '@/utils/stats'
import CatalogSearchBox from './CatalogSearchBox'

// トップページの高さ(scroll-mt)を合わせるため、ホーム用ヘッダーの高さを
// 固定値にしておく(HomeScrollSectionsのスクロールスナップ計算と共有)
export const HOME_HEADER_HEIGHT_PX = 64

const NAV_LINKS = [
  { href: '/', label: 'ホーム' },
  { href: '/search', label: '検索' },
  { href: '/relations', label: '相関図' },
  { href: '/landscape', label: 'ミュージックランドスケープ' },
  { href: '/genres', label: 'ジャンル年表' },
  { href: '/events', label: 'フェス&イベント' },
  { href: '/albums/calendar', label: '新譜カレンダー' },
  { href: '/map', label: 'マップ' },
  { href: '/media', label: 'メディア' },
  { href: '/admin/import', label: 'iTunes登録' },
  { href: '/admin/data', label: '手動データ' },
]

const STAT_ITEMS: { key: keyof SiteStats; label: string; href?: string }[] = [
  { key: 'artist', label: 'アーティスト', href: '/artists' },
  { key: 'album', label: 'アルバム', href: '/albums' },
  { key: 'track', label: 'トラック', href: '/tracks' },
  { key: 'event', label: 'イベント', href: '/events' },
  { key: 'discGuide', label: 'ディスクガイド', href: '/discguides' },
  { key: 'recordShop', label: 'レコードショップ', href: '/map' },
  { key: 'livehouse', label: 'ライブハウス', href: '/map' },
]

export default function SiteHeader({ stats }: { stats: SiteStats }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname()

  // トップページだけは検索欄そのものをヘッダーにする(フルスクロール形式の
  // デザインに合わせる)。他ページのヘッダー(統計バー・ナビメニュー)は変えない。
  if (pathname === '/') {
    return (
      <header
        className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur"
        style={{ height: HOME_HEADER_HEIGHT_PX }}
      >
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="Music Synapse" className="h-8 w-8 shrink-0 object-contain" />
          </Link>
          <div className="min-w-0 flex-1">
            <CatalogSearchBox variant="overlay" />
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="メニュー"
            className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-1.5"
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

        {menuOpen && (
          <nav className="absolute inset-x-0 top-full border-t border-white/10 bg-[#0a0a0a]">
            <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-1 px-6 py-3 sm:flex sm:flex-row sm:flex-wrap sm:gap-2">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-2 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white sm:px-3"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>
    )
  }

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2" onClick={() => setMenuOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="Music Synapse" className="h-8 w-8 shrink-0 object-contain" />
          <span className="hidden text-base font-bold tracking-tight text-white sm:inline">Music Synapse</span>
        </Link>

        <div className="hidden min-w-0 flex-1 items-center justify-center gap-x-4 gap-y-1 overflow-x-auto text-xs text-white/50 lg:flex">
          {STAT_ITEMS.map((item) => {
            const content = (
              <span className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-semibold text-white">{stats[item.key].toLocaleString()}</span>
                <span>{item.label}</span>
              </span>
            )
            return item.href ? (
              <Link key={item.key} href={item.href} className="transition hover:text-white">
                {content}
              </Link>
            ) : (
              <span key={item.key}>{content}</span>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="メニュー"
          className="flex h-8 w-8 shrink-0 flex-col items-center justify-center gap-1.5"
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
        className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
          menuOpen ? 'max-h-[32rem]' : 'max-h-0'
        }`}
      >
        <div className="mx-auto grid max-w-[1600px] grid-cols-2 gap-1 border-t border-white/10 px-6 py-3 sm:flex sm:flex-row sm:flex-wrap sm:gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-2 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white sm:px-3"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}
