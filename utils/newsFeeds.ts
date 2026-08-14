export type NewsSource = {
  name: string
  feedUrl: string
}

// 主要な音楽メディアのRSSフィード一覧。フィードURLは事前に実アクセスして
// 有効性を確認済み(OTOTOYはAtom形式、他はRSS2.0)。
// 注: TURN(turntokyo.com)は現時点でフィード自体は有効だが記事が0件のため、
// 復活すれば自動的に表示される想定でそのまま残している。
export const NEWS_SOURCES: NewsSource[] = [
  { name: 'OTOTOY', feedUrl: 'https://ototoy.jp/news/feed' },
  { name: 'Qetic', feedUrl: 'https://qetic.jp/feed/' },
  { name: 'indienative', feedUrl: 'https://www.indienative.com/feed/' },
  { name: '音楽ナタリー', feedUrl: 'https://natalie.mu/music/feed/news' },
  { name: 'FNMNL', feedUrl: 'https://fnmnl.tv/feed' },
  { name: 'BARKS', feedUrl: 'https://www.barks.jp/feed/' },
  { name: '音楽と人', feedUrl: 'https://ongakutohito.com/feed/' },
  { name: 'BIG UP!zine', feedUrl: 'https://big-up.style/zine/feed/' },
  { name: 'TURN', feedUrl: 'https://turntokyo.com/feed/' },
]
