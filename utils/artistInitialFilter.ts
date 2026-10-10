// アーティスト一覧の頭文字フィルター。並び順と同じsort_key(読みがあれば読み、無ければ名前)の
// 1文字目で判定する。PostgRESTの正規表現フィルター(~ / ~*)で絞り込む。
export const KANA_ROWS: { key: string; label: string; pattern: string }[] = [
  { key: 'a', label: 'あ', pattern: '^[ぁ-おァ-オヴ]' },
  { key: 'ka', label: 'か', pattern: '^[か-ごカ-ゴヵヶ]' },
  { key: 'sa', label: 'さ', pattern: '^[さ-ぞサ-ゾ]' },
  { key: 'ta', label: 'た', pattern: '^[た-どタ-ド]' },
  { key: 'na', label: 'な', pattern: '^[な-のナ-ノ]' },
  { key: 'ha', label: 'は', pattern: '^[は-ぽハ-ポ]' },
  { key: 'ma', label: 'ま', pattern: '^[ま-もマ-モ]' },
  { key: 'ya', label: 'や', pattern: '^[ゃ-よャ-ヨ]' },
  { key: 'ra', label: 'ら', pattern: '^[ら-ろラ-ロ]' },
  { key: 'wa', label: 'わ', pattern: '^[ゎ-んヮ-ンヷ-ヺ]' },
]

export const LATIN_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export const OTHER_ROWS: { key: string; label: string }[] = [
  { key: 'num', label: '0-9' },
  { key: 'kanji', label: '漢字(読みなし)' },
  { key: 'other', label: 'その他' },
]

type Filterable<Q> = { filter: (column: string, operator: string, value: string) => Q }

/** 頭文字キーに応じた絞り込みをクエリに足す。未知のキーなら何もしない */
export function applyInitialFilter<Q extends Filterable<Q>>(query: Q, initial: string | null): Q {
  if (!initial) return query
  if (/^[A-Z]$/.test(initial)) return query.filter('sort_key', 'imatch', `^${initial}`)
  const kana = KANA_ROWS.find((r) => r.key === initial)
  if (kana) return query.filter('sort_key', 'match', kana.pattern)
  if (initial === 'num') return query.filter('sort_key', 'match', '^[0-9０-９]')
  if (initial === 'kanji') return query.filter('sort_key', 'match', '^[一-龯々〆]')
  if (initial === 'other') {
    return query.filter('sort_key', 'not.match', '^[A-Za-z0-9０-９ぁ-んァ-ヺ一-龯々〆]')
  }
  return query
}

export function isValidInitial(value: string | undefined): value is string {
  if (!value) return false
  return (
    /^[A-Z]$/.test(value) || KANA_ROWS.some((r) => r.key === value) || OTHER_ROWS.some((r) => r.key === value)
  )
}
