'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { pushNavEntry } from './navHistory'

/** ルートレイアウトに1つだけ置き、ページ遷移のたびに「離れたページ」を
 * サイト内履歴へ記録する(BackLinkがこれを読む)。
 * 現在地ではなく1つ前のパスを積むため、遷移が起きた時点で前回値を書き込む。 */
export default function NavHistoryTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const previous = useRef<string | null>(null)

  useEffect(() => {
    const query = searchParams.toString()
    const current = query ? `${pathname}?${query}` : pathname
    if (previous.current && previous.current !== current) {
      pushNavEntry(previous.current)
    }
    previous.current = current
  }, [pathname, searchParams])

  return null
}
