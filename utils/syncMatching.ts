// utils/syncMatching.ts
/**
 * タイアップ候補(sync_candidate)を、カタログ・Apple Musicの曲に照合するときの共通の判定部品。
 * 誤った別人・別曲に紐付けないため、正規化した完全一致を基本にする。
 */

export const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s'’"`.,!?・&\-_/()[\]［］「」『』~〜:：;♪★☆♡×]/g, '')

/** 曲名の比較用。TV size・Short ver.・feat.表記のような「同じ曲の付記」だけを外す。
 * English ver. / Remix / Live など、別バージョンを示す表記は外さない(別の曲に紐付けないため) */
const SAME_SONG_NOTE = /[(（[［]\s*(?:tv\s*(?:size|ver\.?|edit)|short\s*(?:ver\.?|size)|feat\.?[^)）\]］]*|featuring[^)）\]］]*)\s*[)）\]］]/gi
export const normTitle = (s: string) =>
  norm(
    s
      .normalize('NFKC')
      .replace(SAME_SONG_NOTE, '')
      .replace(/[-–—]\s*(?:tv\s*(?:size|ver\.?|edit)|short\s*(?:ver\.?|size))\s*[-–—]?/gi, '')
      .replace(/\s+(?:feat\.?|featuring)\s+.+$/i, '')
  )

export const BAD_VERSION = /live|ライブ|karaoke|カラオケ|instrumental|インスト|off vocal|オフボーカル|acoustic|アコースティック|remix|リミックス|orchestra|オーケストラ|cover|カバー|ピアノ|piano/i

/** 歌い手の表記から、照合に使う名前の候補(完全な表記→先頭の名前)を作る */
export function artistVariants(name: string): string[] {
  const out = [name]
  const first = name.split(/\s*(?:feat\.?|featuring|with|×|＆|&|、|,|と|\/|・)\s*/i)[0]?.trim()
  if (first && first !== name) out.push(first)
  const noParen = name.replace(/[（(][^）)]*[）)]/g, '').trim()
  if (noParen && !out.includes(noParen)) out.push(noParen)
  // キャラクター名義「阿波連れいな（水瀬いのり）」は、括弧の中(声優・歌い手)の名前でも探す
  for (const m of name.matchAll(/[（(]([^）)]+)[）)]/g)) {
    for (const inner of m[1].split(/\s*[、,・/]\s*/)) {
      const v = inner.trim()
      if (v.length >= 2 && !out.includes(v)) out.push(v)
    }
  }
  return out.filter(Boolean)
}
