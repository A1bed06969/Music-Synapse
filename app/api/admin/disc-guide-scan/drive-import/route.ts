// utils/discGuideDriveDispatch.tsからのみ叩かれる内部専用エンドポイント。
// Google Driveフォルダ内の画像を1回の呼び出しにつき1枚だけGeminiで抽出し、
// 続きを自分自身に再ディスパッチする(理由・ホップ間遅延の必要性は
// app/api/admin/album-sync/route.tsのコメント参照)。
//
// 元々はtesseract.js(ローカルOCR)で処理していたが、実際のページで精度・
// レイアウト分割の両方が実用に耐えなかったためGemini APIでの直接構造化
// 抽出に切り替えた(utils/geminiDiscGuideExtract.ts参照)。1呼び出し1枚に
// 固定しているのは実行時間対策ではなく、Gemini無料枠の呼び出し回数制限
// (分間・日次)を超えないよう、既存のホップ間隔(3秒)でペース配分するため。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { downloadDriveFile, type DriveImageFile } from '@/utils/googleDrive'
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport'
import { extractAlbumsWithGemini } from '@/utils/geminiDiscGuideExtract'
import { dispatchDriveImport } from '@/utils/discGuideDriveDispatch'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { discGuideId, folderId, files, startIndex } = body as {
    discGuideId: string
    folderId: string
    files: DriveImageFile[]
    startIndex: number
  }

  if (!discGuideId || !folderId || !Array.isArray(files)) {
    return NextResponse.json({ error: 'discGuideId, folderId and files are required' }, { status: 400 })
  }

  after(async () => {
    const supabase = createAdminClient()
    const file = files[startIndex]

    if (file) {
      try {
        const buffer = await downloadDriveFile(file.id)
        const imageUrl = `data:${file.mimeType};base64,${buffer.toString('base64')}`

        const extracted = await extractAlbumsWithGemini(buffer, file.mimeType)
        const matched = await matchAlbumsWithCandidates(supabase, extracted)

        const { error } = await supabase.from('disc_guide_scan_pending').insert({
          disc_guide_id: discGuideId,
          image_filename: file.name,
          image_url: imageUrl,
          extracted_data: extracted,
          extraction_confidence: null,
          matched_data: matched,
          status: 'pending',
        })
        if (error) {
          console.error(`Drive画像の保存に失敗しました(${file.name}):`, error.message)
        } else {
          console.log(`Drive画像OCR完了(${file.name})`)
        }
      } catch (err) {
        console.error(`Drive画像の処理に失敗しました(${file.name}):`, err)
      }
    }

    const nextIndex = startIndex + 1
    if (nextIndex < files.length) {
      // Geminiが即座にエラーを返すケース(無料枠の混雑503など)が連続すると、
      // 実処理時間がほぼ無くホップの発火間隔が3秒ちょうどまで詰まり、Vercelの
      // ループ検知(508)を誘発することを本番の89枚一括取込で確認した
      // (extractAlbumsWithGemini側のリトライ待機で個々の失敗はある程度緩和した
      // うえで、念のためここも3秒→6秒に広げて安全マージンを確保する)。
      await new Promise((resolve) => setTimeout(resolve, 6_000))
      await dispatchDriveImport(discGuideId, folderId, files, nextIndex)
    } else {
      console.log(`Drive画像取込完了(フォルダ${folderId}): ${files.length}件`)
      revalidatePath(`/admin/data/discguides/${discGuideId}`)
    }
  })

  return NextResponse.json({ dispatched: true, total: files.length })
}
