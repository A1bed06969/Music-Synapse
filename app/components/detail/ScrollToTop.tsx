'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/** ページ(パス)が変わったときに先頭へ戻す。スマホでは、前のページで下までスクロールしていると、
 * 詳細ページがその位置のまま途中から開いてしまうことがあるため。同じページ内の切り替え(?s= など、パスが変わらないもの)では動かない */
export default function ScrollToTop() {
  const pathname = usePathname()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
