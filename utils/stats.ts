import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'

export type SiteStats = {
  artist: number
  album: number
  track: number
  event: number
  discGuide: number
  recordShop: number
  livehouse: number
}

// unstable_cacheのスコープ内ではcookies()を読めないため、utils/Supabase/server.tsの
// createClient(cookieStoreを使う)ではなくcookieに触らないanonクライアントを使う。
// 公開読み取りポリシーで足りる件数取得のみなのでanonキーで問題ない。
function createCookielessClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function fetchStats(): Promise<SiteStats> {
  const supabase = createCookielessClient()

  const [artist, album, track, event, discGuide, recordShop, livehouse] = await Promise.all([
    supabase.from('artist').select('*', { count: 'exact', head: true }),
    supabase.from('album').select('*', { count: 'exact', head: true }),
    supabase.from('track').select('*', { count: 'exact', head: true }),
    supabase.from('event').select('*', { count: 'exact', head: true }),
    supabase.from('disc_guide').select('*', { count: 'exact', head: true }),
    supabase.from('recordshop').select('*', { count: 'exact', head: true }),
    supabase.from('livehouse').select('*', { count: 'exact', head: true }),
  ])

  return {
    artist: artist.count ?? 0,
    album: album.count ?? 0,
    track: track.count ?? 0,
    event: event.count ?? 0,
    discGuide: discGuide.count ?? 0,
    recordShop: recordShop.count ?? 0,
    livehouse: livehouse.count ?? 0,
  }
}

// ルートレイアウトのSiteHeaderが全ページで毎回awaitするため、キャッシュしないと
// 全ページの遷移がこの7クエリ(track 81万件等のcount:exactを含む)分だけブロックされる。
// Next.jsのloading.jsドキュメント曰く、レイアウトが未キャッシュデータを読むと
// loading.tsxのフォールバックが表示されず「クリックしても何も起きない」状態になる。
// ヘッダーの件数表示は概数で十分なので1時間キャッシュする。
export const getStats = unstable_cache(fetchStats, ['site-stats'], { revalidate: 3600 })
