'use client'

import { useState } from 'react'

/** LEFTカラムのBiographyを初期5〜8行に折りたたみ、「Read More」で全文展開する。
 * LEFTカラムはsticky(1画面に収める方針)のため、長文Biographyがそのまま
 * スクロールを要求してしまわないようにする。 */
export default function BiographyReadMore({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <p className={`whitespace-pre-wrap text-sm leading-relaxed text-white/70 ${expanded ? '' : 'line-clamp-6'}`}>
        {text}
      </p>
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs text-white/50 underline-offset-2 hover:text-white hover:underline"
        >
          Read More →
        </button>
      )}
    </div>
  )
}
