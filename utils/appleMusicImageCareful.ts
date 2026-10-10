// Apple Musicのアーティストページ(og:image)から画像URLを取る、一括処理向けの慎重版。
// utils/appleMusicImage.tsのfetchAppleMusicArtistImageは失敗をすべてnullにするため、
// Apple側の制限・拒否(429/403)に気づけない。一括処理ではこれを例外にして呼び出し側で止める。
import { extractOgImage, isApplePlaceholderImage } from '@/utils/ogImage'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export class AppleMusicBlockedError extends Error {}

/** 戻り値: 画像URL / 'none'(ページはあるが写真もジャケットも無い=汎用ロゴ) / null(取得失敗) */
export async function fetchArtistImageCarefully(appleMusicArtistId: string, country = 'JP'): Promise<string | 'none' | null> {
  const res = await fetch(`https://music.apple.com/${country.toLowerCase()}/artist/${appleMusicArtistId}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 429 || res.status === 403) {
    throw new AppleMusicBlockedError(`Apple Musicが${res.status}を返しました(制限・拒否の可能性)`)
  }
  if (!res.ok) return null
  const imageUrl = extractOgImage(await res.text())
  if (imageUrl && isApplePlaceholderImage(imageUrl)) return 'none'
  // 末尾のサイズ指定(例: /1200x630cw.png)を正方形の600x600に揃える
  return imageUrl ? imageUrl.replace(/\/\d+x\d+[a-z]{2}\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/600x600bb.$1$2') : null
}

/** 一括処理で1件ごとに空ける間隔(2〜3秒、機械的な一定間隔にしないため揺らぎを付ける) */
export function carefulInterval(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1000))
}
