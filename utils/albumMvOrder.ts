// utils/albumMvOrder.ts

export type AlbumMvOrderTrack = {
  id: string
  disc_number: number | null
  track_no: number | null
  youtube_video_id: string | null
}

/** アルバムのMVタブ用に、YouTube動画を持つ収録曲だけを抽出し、
 * ディスク番号→トラック番号の昇順に並べた上で、代表曲(representative_track_id)
 * があればそれを先頭に繰り上げる。ジェネリクスにしているのは、呼び出し側が
 * タイトル等の追加フィールドを持つ型を渡してもそのまま維持されるようにするため
 * (utils/albumMvOrder.ts単体では最小限のフィールドしか知らない)。 */
export function orderAlbumTracksForMv<T extends AlbumMvOrderTrack>(
  tracks: T[],
  representativeTrackId: string | null
): T[] {
  const withVideo = tracks.filter((t) => t.youtube_video_id)
  const sorted = [...withVideo].sort((a, b) => {
    const discA = a.disc_number ?? 1
    const discB = b.disc_number ?? 1
    if (discA !== discB) return discA - discB
    const noA = a.track_no ?? 0
    const noB = b.track_no ?? 0
    return noA - noB
  })
  if (!representativeTrackId) return sorted
  const repIndex = sorted.findIndex((t) => t.id === representativeTrackId)
  if (repIndex <= 0) return sorted
  const rep = sorted[repIndex]
  return [rep, ...sorted.slice(0, repIndex), ...sorted.slice(repIndex + 1)]
}
