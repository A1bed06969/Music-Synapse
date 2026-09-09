import type { AlbumType } from './albumType'

/** Discography専用の種別区分。DBの`album_type`(既存6種)に加えて、
 * 「アルバム名義はVarious Artists等だが収録曲はこのアーティスト名義」という
 * オムニバス収録を独自に検出して追加する(app/artists/[id]/discography/page.tsx参照)。
 * DBの生値ではないため、既存のutils/albumType.tsは変更せずここだけで定義する
 * (admin編集画面等、既存6種のみを前提にしている箇所に影響を出さないため)。
 *
 * Server Component(discography/page.tsx)とClient Component
 * (DiscographyFilters.tsx)の両方から使う定数なので、'use client'を持つ
 * ファイルには置かない — RSCバンドラがクライアント参照用のプロキシに
 * 置き換えてしまい、配列メソッド(reduce等)が使えなくなる。 */
export type DiscographyType = AlbumType | 'Omnibus'

export const ALBUM_FAMILY: DiscographyType[] = ['Album', 'Live', 'Remix', 'Best', 'Omnibus']
export const SINGLE_FAMILY: DiscographyType[] = ['Single', 'EP']

export type DiscographyCounts = Record<DiscographyType, number> & {
  albumFamily: number
  singleFamily: number
}
