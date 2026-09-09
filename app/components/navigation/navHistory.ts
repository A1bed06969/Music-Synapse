/** サイト内のどのページから来たかを記録し、「戻る」導線に使うための仕組み。
 *
 * 従来は各詳細ページの「戻る」リンクが`/search`や一覧ページに固定されており、
 * 特集ページやランキングから流入した場合に元のページへ戻れなかった。
 * NavHistoryTrackerが遷移のたびに直前のパスをsessionStorageへ積み、
 * BackLinkがそれを読んで「元いたページへ戻る」導線を出す。
 *
 * sessionStorageを使うのはタブ単位で完結させるため(別タブの履歴と混ざらない)。
 * 直接URLで開いた場合など履歴が無いときは各ページが指定するフォールバック先へ。 */

const STORAGE_KEY = 'ms-nav-history'
const MAX_ENTRIES = 20

export type NavEntry = { path: string; label: string }

/** パスから「◯◯に戻る」の◯◯にあたる日本語ラベルを作る。
 * 個別ページ(詳細)は具体名まで持っていないため種別名で表す。 */
export function labelForPath(path: string): string {
  const clean = path.split('?')[0].replace(/\/$/, '') || '/'

  const exact: Record<string, string> = {
    '/': 'トップ',
    '/artists': 'アーティスト一覧',
    '/albums': 'アルバム一覧',
    '/albums/calendar': 'リリースカレンダー',
    '/tracks': 'トラック一覧',
    '/search': '検索',
    '/genres': 'ジャンル一覧',
    '/labels': 'レーベル一覧',
    '/events': 'イベント一覧',
    '/map': '地図',
    '/discguides': 'ディスクガイド',
    '/chronology': '年表',
    '/relations': '相関図',
    '/landscape': 'ジャンルマップ',
    '/new-arrivals': '新着',
    '/media': 'メディア',
    '/media/features': '特集一覧',
    '/media/news': 'ニュース',
    '/media/playlists': 'プレイリスト',
    '/media/on-air': 'オンエア',
    '/media/sync': 'タイアップ',
  }
  if (exact[clean]) return exact[clean]

  const prefix: [RegExp, string][] = [
    [/^\/artists\/[^/]+\/timeline$/, 'アーティスト年表'],
    [/^\/artists\/[^/]+$/, 'アーティストページ'],
    [/^\/albums\/[^/]+$/, 'アルバムページ'],
    [/^\/tracks\/instrument\/[^/]+$/, '楽器別トラック'],
    [/^\/tracks\/[^/]+$/, 'トラックページ'],
    [/^\/people\/[^/]+$/, 'クレジットページ'],
    [/^\/media\/features\/[^/]+$/, '特集'],
    [/^\/media\/sync\/[^/]+$/, 'タイアップ'],
    [/^\/genres\/[^/]+$/, 'ジャンルページ'],
    [/^\/labels\/[^/]+$/, 'レーベルページ'],
    [/^\/events\/[^/]+$/, 'イベントページ'],
    [/^\/shops\/[^/]+$/, 'レコードショップ'],
    [/^\/livehouses\/[^/]+$/, 'ライブハウス'],
  ]
  for (const [re, label] of prefix) {
    if (re.test(clean)) return label
  }
  return '前のページ'
}

// BackLinkはuseSyncExternalStoreでこのモジュールを購読する。
// NavHistoryTrackerの書き込み(遷移直後のeffect)はBackLinkの初回描画より後に走るため、
// 購読していないと「戻る」導線が古いまま(フォールバック表示のまま)になる。
const listeners = new Set<() => void>()
let version = 0
const snapshotCache = new Map<string, { version: number; json: string | null }>()

export function subscribeNavHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

/** useSyncExternalStore用のスナップショット。同じ内容なら同じ文字列を返す必要が
 * あるため(参照が変わり続けると再描画ループになる)、versionが変わるまでキャッシュする。 */
export function getPreviousEntrySnapshot(currentPath: string): string | null {
  const cached = snapshotCache.get(currentPath)
  if (cached && cached.version === version) return cached.json
  const entry = getPreviousEntry(currentPath)
  const json = entry ? JSON.stringify(entry) : null
  snapshotCache.set(currentPath, { version, json })
  return json
}

function read(): NavEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as NavEntry[]) : []
  } catch {
    return []
  }
}

function write(entries: NavEntry[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // プライベートブラウジング等でsessionStorageが使えない場合は履歴無しとして扱う
  }
}

/** 遷移が起きたときに、離脱したページを履歴へ積む。
 * 同じパスの連続(クエリだけ変わる検索など)は積み増さず最新の1件に置き換える。 */
export function pushNavEntry(path: string): void {
  const entries = read()
  const last = entries[entries.length - 1]
  const entry: NavEntry = { path, label: labelForPath(path) }
  if (last && last.path.split('?')[0] === path.split('?')[0]) {
    entries[entries.length - 1] = entry
  } else {
    entries.push(entry)
  }
  write(entries)
  notify()
}

/** 直前にいたサイト内ページ。無ければnull(直接URLで開いた等)。
 * 現在地と同じパスのエントリは戻り先として無意味なので読み飛ばす。 */
export function getPreviousEntry(currentPath: string): NavEntry | null {
  const entries = read()
  const currentClean = currentPath.split('?')[0]
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].path.split('?')[0] !== currentClean) return entries[i]
  }
  return null
}
