'use client'

import { useState, type ReactNode } from 'react'

/** 年ごと・100件ごとの区切り。一覧が数千件になる企画(bounceなど)で、全部を一度に並べると、スマホで何十万pxにもなるため、
 * 新しい区切りだけを開いておき、残りは見出し(と件数)だけにして、押したときに中身を出す。 */
export default function CollapsibleSection({
  title,
  suffix,
  count,
  unit = '件',
  defaultOpen = false,
  first = false,
  children,
}: {
  title: string
  /** 見出しの右に添える小さな文字(例: 「年」) */
  suffix?: string
  count: number
  unit?: string
  defaultOpen?: boolean
  first?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={first ? 'mt-6' : 'mt-8'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-4 text-left"
      >
        <h3 className="text-2xl font-bold text-white">
          {title}
          {suffix && <span className="ml-1 text-sm font-medium text-white/40">{suffix}</span>}
        </h3>
        <span className="h-px flex-1 bg-white/15" />
        <span className="shrink-0 text-xs tabular-nums text-white/40">
          {count}
          {unit}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-white/50 transition ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  )
}
