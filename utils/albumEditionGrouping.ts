// utils/albumEditionGrouping.ts
//
// デラックス版・地域別版・ボーナス版などの「版違い」アルバムを、タイトル正規化で
// グループ化するロジック。ジャケット画像の比較は行わない(タイトルのみで判定)。
// 過検出(誤って別作品をまとめる)より過小検出(まとめ漏れ)を優先する方針のため、
// 版表記キーワードは「これが付いていれば版違いとほぼ断定できる」語だけに絞っている。
// まとめ漏れは管理画面(app/admin/data/albums/edition-groups/)から手動で救える。

const EDITION_KEYWORDS = [
  'edition',
  'version',
  'deluxe',
  'bonus',
  'remaster',
  'remastered',
  'anniversary',
  'extended',
  'expanded',
  'complete',
  'definitive',
  'special',
  'mix',
  'live',
  'explicit',
  'clean',
  'exclusive',
  'international',
  'target',
  'walmart',
]

// 末尾の括弧(...)/[...]のうち、版表記キーワードを含むものにマッチする。
// 複数の括弧が連続する場合に対応するため、呼び出し側でマッチしなくなるまで
// 繰り返し適用する。
const TRAILING_EDITION_BRACKET_RE = new RegExp(
  `\\s*[([][^()[\\]]*\\b(${EDITION_KEYWORDS.join('|')})\\b[^()[\\]]*[)\\]]\\s*$`,
  'i'
)

export function normalizeAlbumTitleForGrouping(title: string): string {
  let normalized = title.trim().normalize('NFKC')
  while (TRAILING_EDITION_BRACKET_RE.test(normalized)) {
    normalized = normalized.replace(TRAILING_EDITION_BRACKET_RE, '').trim()
  }
  return normalized
}

export type AlbumForGrouping = {
  id: string
  artistId: string
  title: string
  releaseDate: string | null
  albumType: string | null
}

export type EditionGroup = {
  primaryId: string
  editionIds: string[]
}

const GROUPABLE_ALBUM_TYPES = new Set(['Album', 'EP', 'Live'])

export function groupAlbumsForEditionMerge(albums: AlbumForGrouping[]): EditionGroup[] {
  const buckets = new Map<string, AlbumForGrouping[]>()

  for (const album of albums) {
    if (!album.albumType || !GROUPABLE_ALBUM_TYPES.has(album.albumType)) continue
    const key = `${album.artistId}::${normalizeAlbumTitleForGrouping(album.title).toLowerCase()}`
    const bucket = buckets.get(key) ?? []
    bucket.push(album)
    buckets.set(key, bucket)
  }

  const groups: EditionGroup[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue

    const sorted = [...bucket].sort((a, b) => {
      const dateA = a.releaseDate ?? '9999-99-99'
      const dateB = b.releaseDate ?? '9999-99-99'
      if (dateA !== dateB) return dateA.localeCompare(dateB)
      return a.id.localeCompare(b.id)
    })

    const [primary, ...rest] = sorted
    groups.push({ primaryId: primary.id, editionIds: rest.map((a) => a.id) })
  }

  return groups
}
