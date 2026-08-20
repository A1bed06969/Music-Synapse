// utils/discGuideDriveDispatch.tsからのみ叩かれる内部専用エンドポイント。
// Google Driveフォルダ内の画像を1件ずつOCR処理しつつ経過時間を計測し、
// maxDurationの安全マージン内で打ち切ったら続きを自分自身に再ディスパッチする
// (理由・ホップ間遅延の必要性はapp/api/admin/album-sync/route.tsのコメント参照。
// 実際にVercelのループ検知(508)へ引っかかることを確認済みのため、
// 同じ緩和策(遅延+短めのチャンク予算)を最初から適用する)。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { downloadDriveFile, type DriveImageFile } from '@/utils/googleDrive'
import { performOCR, parseOCRToAlbums, matchAlbumsWithCandidates } from '@/utils/discGuideImport'
import { dispatchDriveImport } from '@/utils/discGuideDriveDispatch'

export const maxDuration = 60
const TIME_BUDGET_MS = 40_000

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
    const startedAt = Date.now()
    let i = startIndex

    for (; i < files.length; i++) {
      if (i > startIndex && Date.now() - startedAt > TIME_BUDGET_MS) break
      const file = files[i]
      try {
        const buffer = await downloadDriveFile(file.id)
        const imageUrl = `data:${file.mimeType};base64,${buffer.toString('base64')}`

        const ocrResult = await performOCR(imageUrl)
        const extracted = await parseOCRToAlbums(ocrResult.text)
        const matched = await matchAlbumsWithCandidates(supabase, extracted)

        const { error } = await supabase.from('disc_guide_scan_pending').insert({
          disc_guide_id: discGuideId,
          image_filename: file.name,
          image_url: imageUrl,
          extracted_data: extracted,
          extraction_confidence: ocrResult.confidence,
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

    if (i < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      await dispatchDriveImport(discGuideId, folderId, files, i)
    } else {
      console.log(`Drive画像取込完了(フォルダ${folderId}): ${files.length}件`)
      revalidatePath(`/admin/data/discguides/${discGuideId}`)
    }
  })

  return NextResponse.json({ dispatched: true, total: files.length })
}
