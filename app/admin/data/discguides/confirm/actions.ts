'use server'

// app/admin/data/discguides/confirm/actions.ts
//
// ConfirmationClient.tsxの手動検索(自動マッチング候補が無い/確度が低いエントリ用)は
// 元々自前DB(album テーブル)しか検索していなかったが、ディスクガイドで見つかる
// アルバムの大半はまだ自前DBに登録されていないため、ほとんどヒットしなかった。
// Apple Music(iTunes)のカタログ全体を直接検索できるようにする。
//
// SearchableSelectが選んだidをそのままconfirmed_data.albums[].album_idとして
// /api/admin/disc-guide-scan/registerに送るため、「これはまだ自前DBに無い、
// iTunesのcollectionId」だと後段で判別できるよう`itunes:`プレフィックスを付ける
// (register route側でこのプレフィックスを見てregisterAlbumFromSearchを呼ぶ)。
import { searchAlbums as searchItunesAlbums } from '@/utils/itunes'

export type PickerItem = { id: string; label: string; imageUrl?: string }

export async function searchAppleMusicAlbums(query: string): Promise<PickerItem[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  let results
  try {
    results = await searchItunesAlbums(trimmed, 10)
  } catch {
    return []
  }

  return results.map((a) => ({
    id: `itunes:${a.collectionId}`,
    label: `${a.collectionName} — ${a.artistName}`,
    imageUrl: a.artworkUrl100,
  }))
}
