'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ADMIN_TOOL_GROUPS } from './adminTools'

function NavGroups({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      {ADMIN_TOOL_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/30">{group.label}</p>
          <ul className="mt-2 flex flex-col gap-0.5">
            {group.tools.map((tool) => {
              const active = pathname === tool.href
              return (
                <li key={tool.href}>
                  <Link
                    href={tool.href}
                    onClick={onNavigate}
                    className={`block rounded px-2 py-1 text-xs transition ${
                      active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                    }`}
                  >
                    {tool.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function AdminSidebarNav() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // レイアウトはadmin配下のページ遷移をまたいで再マウントされないため、
  // ページ遷移後もメニューが開いたままになる。パス変化を検知して閉じる。
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:hidden">
        <Link href="/admin/data" className="text-sm font-bold text-white/80 hover:text-white">
          管理画面
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70"
        >
          {mobileOpen ? '閉じる ✕' : 'メニュー ☰'}
        </button>
      </div>
      {mobileOpen && (
        <div className="border-b border-white/10 px-4 py-4 md:hidden">
          <NavGroups pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </div>
      )}

      <nav className="hidden w-56 shrink-0 border-r border-white/10 py-8 pl-4 pr-4 md:block">
        <Link href="/admin/data" className="text-sm font-bold text-white/80 hover:text-white">
          管理画面
        </Link>
        <div className="mt-6">
          <NavGroups pathname={pathname} />
        </div>
      </nav>
    </>
  )
}
