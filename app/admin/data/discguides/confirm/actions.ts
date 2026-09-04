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
import { judgeAlbumMatchWithGemini, type AlbumMatchCandidate } from '@/utils/geminiAlbumMatch'

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

type AlbumExtract = { title: string; artist_name: string; label?: string; release_year?: number }
type MatchCandidateInput = { id: string; title: string; artist_name: string; similarity?: number; artwork_url?: string }
type MatchResultInput = { extracted_index: number; candidates: MatchCandidateInput[] }

export type DiscGuideJudgement = {
  extractedIndex: number
  candidateIndex: number | null
  confidence: number
  reasoning: string
}

/** ディスクガイド確認画面(ConfirmationClient.tsx)の「Geminiで自動判定」ボタンから
 * 呼ぶ。まだDBに未登録の下書き段階(disc_guide_scan_pending)が対象のため、ここでは
 * 判定結果を返すだけでDBへの書き込みは一切行わない。呼び出し側(クライアント)が
 * selections stateを更新し、実際の登録は既存の「確認して登録」ボタンが担当する
 * (タワレコメン等の事後マッチングと違い、登録前に必ず人力確認が挟まる分、
 * ログ記録・自動反映・取消の仕組みは不要)。 */
export async function judgeDiscGuideCandidatesWithGemini(
  extracted: AlbumExtract[],
  matched: MatchResultInput[]
): Promise<DiscGuideJudgement[]> {
  const results: DiscGuideJudgement[] = []

  for (const m of matched) {
    const album = extracted[m.extracted_index]
    if (!album || !m.candidates || m.candidates.length === 0) {
      results.push({ extractedIndex: m.extracted_index, candidateIndex: null, confidence: 0, reasoning: '候補が無いため判定不可' })
      continue
    }

    const matchCandidates: AlbumMatchCandidate[] = m.candidates.map((c, index) => ({
      index,
      id: c.id,
      title: c.title,
      artistName: c.artist_name,
      similarity: c.similarity ?? 0,
      source: c.id.startsWith('itunes:') ? 'apple_music' : 'local',
    }))

    try {
      const judgement = await judgeAlbumMatchWithGemini(album.title, album.artist_name, 'ディスクガイド', matchCandidates, {
        label: album.label,
        releaseYear: album.release_year,
      })
      results.push({ extractedIndex: m.extracted_index, ...judgement })
    } catch (err) {
      results.push({
        extractedIndex: m.extracted_index,
        candidateIndex: null,
        confidence: 0,
        reasoning: `判定に失敗しました: ${(err as Error).message}`,
      })
    }
  }

  return results
}
