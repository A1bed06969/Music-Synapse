// Apple Music(mzstatic)の画像URLは末尾の「/1200x1200bb.jpg」でサイズを指定できる。
// 一覧やカレンダーで原寸(1枚数百KB)を大量に読むと、スマホでは読み込みきれず表示されないため、
// 表示サイズに合わせた小さい画像に差し替える。Apple以外のURLはそのまま返す。
export function artworkAt(url: string | null | undefined, px: number): string | null {
  if (!url) return null
  if (!/mzstatic\.com/.test(url)) return url
  return url.replace(/\/\d+x\d+([a-z]{2})\.(jpg|jpeg|png|webp)(\?.*)?$/i, `/${px}x${px}$1.$2$3`)
}
