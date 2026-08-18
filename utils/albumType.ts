export type AlbumType = 'Album' | 'EP' | 'Single' | 'Remix' | 'Live' | 'Best'

export const ALBUM_TYPE_LABEL_JA: Record<AlbumType, string> = {
  Album: 'スタジオアルバム',
  EP: 'EP',
  Single: 'シングル',
  Remix: 'リミックスアルバム',
  Live: 'ライブアルバム',
  Best: 'ベストアルバム',
}

export const ALBUM_TYPE_ORDER: AlbumType[] = ['Album', 'EP', 'Single', 'Remix', 'Live', 'Best']

/** タイトル・トラック数からアルバムの種別を推定する。優先順位:
 * シングル→EP→リミックス→ライブ→ベスト→スタジオ(既定値) */
export function classifyAlbumType(title: string, trackCount: number | null): AlbumType {
  if (/\bsingle\b/i.test(title) || trackCount === 1) return 'Single'
  if (/\bep\b/i.test(title) || trackCount === 4) return 'EP'
  if (/remix|リミックス/i.test(title)) return 'Remix'
  if (/\blive\b|ライブ|ライヴ/i.test(title)) return 'Live'
  if (/\bbest\b|ベスト|greatest hits/i.test(title)) return 'Best'
  return 'Album'
}
