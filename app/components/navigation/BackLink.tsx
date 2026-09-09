'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { subscribeNavHistory, getPreviousEntrySnapshot, type NavEntry } from './navHistory'

/** 詳細ページ上部の「戻る」導線。
 *
 * サイト内の別ページから来ていればそこへ戻す(ブラウザの戻る=router.back()を使うので
 * 一覧ページの絞り込み状態やスクロール位置も復元される)。直接URLで開かれた場合だけ
 * fallbackHrefへのリンクにフォールバックするため、従来の固定リンクの挙動も失われない。
 *
 * サーバー側では履歴を知り得ないのでサーバースナップショットはnull(=フォールバック表示)。
 * 遷移直後にNavHistoryTrackerが履歴を書き込んだタイミングで購読経由で差し替わる。 */
export default function BackLink({
  fallbackHref,
  fallbackLabel,
}: {
  fallbackHref: string
  fallbackLabel: string
}) {
  const pathname = usePathname()
  const router = useRouter()

  const previousJson = useSyncExternalStore(
    subscribeNavHistory,
    () => getPreviousEntrySnapshot(pathname),
    () => null
  )
  const previous: NavEntry | null = previousJson ? (JSON.parse(previousJson) as NavEntry) : null

  const className = 'text-xs text-white/40 transition hover:text-white/70'

  if (previous) {
    return (
      <button type="button" onClick={() => router.back()} className={className}>
        ← {previous.label}に戻る
      </button>
    )
  }

  return (
    <Link href={fallbackHref} className={className}>
      ← {fallbackLabel}
    </Link>
  )
}
