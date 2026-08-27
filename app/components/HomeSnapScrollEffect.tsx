'use client'

import { useEffect } from 'react'

/**
 * トップページ滞在中だけ<body>にスクロールスナップ用のクラスを付与する
 * (フルスクロール形式はトップページ限定の見た目のため、globals.cssで
 * 全ページ一律にするとサイト全体の挙動が変わってしまう)。他ページへ遷移
 * すると自動的に外れる。
 */
const CLASSES = ['h-screen', 'overflow-y-scroll', 'snap-y', 'snap-mandatory']

export default function HomeSnapScrollEffect() {
  useEffect(() => {
    document.body.classList.add(...CLASSES)
    return () => {
      document.body.classList.remove(...CLASSES)
    }
  }, [])

  return null
}
