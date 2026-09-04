'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { inputClass } from './adminUi'

type PickerItem = { id: string; label: string }

/** カタログ全アーティストを事前に一括取得してクライアント側でフィルタする
 * 実装だった(page.tsxでfetchAllRows)が、アーティスト数が4000件超に増えたことで
 * ページ読み込みのたびにPostgRESTの1000件上限を跨いだ複数往復取得＋巨大な
 * ペイロード転送が発生し、「手動データ」への遷移が体感できるほど遅くなっていた。
 * SearchableSelect(app/admin/data/actions.tsのsearchArtists)と同じ、入力の
 * たびにサーバー側で絞り込み検索する方式に切り替える。 */
export default function AdminArtistSearchList({
  searchAction,
  totalCount,
}: {
  searchAction: (query: string) => Promise<PickerItem[]>
  totalCount: number
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickerItem[]>([])
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    // queryが空の間はresultsを更新しない(下の表示側でquery.trim()===''を
    // 先に判定して無視するため、古いresultsが残っていても実害無い)
    if (!trimmed) return
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current
      startTransition(async () => {
        const items = await searchAction(trimmed)
        if (requestId !== requestIdRef.current) return
        setResults(items)
      })
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, searchAction])

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="アーティスト名で検索..."
        className={`${inputClass} max-w-sm`}
      />
      {query.trim() === '' ? (
        <p className="mt-4 text-sm text-white/40">アーティスト名を入力すると一覧が表示されます({totalCount}件登録済み)</p>
      ) : isPending ? (
        <p className="mt-4 text-sm text-white/40">検索中...</p>
      ) : results.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">該当するアーティストが見つかりませんでした。</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-white/40">{results.length}件{results.length >= 20 && '(上位20件を表示)'}</p>
          <ul className="mt-2 max-h-[60vh] divide-y divide-white/10 overflow-y-auto">
            {results.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span>{a.label}</span>
                <Link href={`/admin/data/artists/${a.id}/edit`} className="text-xs text-white/40 hover:text-white/70">
                  編集 →
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
