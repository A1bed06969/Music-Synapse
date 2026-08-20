// utils/discGuideDriveDispatch.tsからのみ叩かれる内部専用エンドポイント。
// Google Driveフォルダ内の画像を1回の呼び出しにつき1枚だけOCR処理し、
// 続きを自分自身に再ディスパッチする(理由・ホップ間遅延の必要性は
// app/api/admin/album-sync/route.tsのコメント参照)。
//
// 以前は複数枚を経過時間で打ち切りながら処理していたが、実際のiPhone写真
// (12MP)のOCRは本番のVercel CPU上で1枚あたり数十秒かかることがあり、
// 1回のチャンクで2枚目に着手した直後にmaxDuration(60秒)へ達して関数ごと
// 強制終了され、エラーも残らず処理が無言で止まる不具合が本番で複数回
// 再現した(縮小処理で軽減はしたが解消しきれなかった)。1呼び出し1枚に
// 固定することで、1枚の処理時間がどれだけ延びてもmaxDurationの範囲内に
// 収まることを保証する。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { downloadDriveFile, type DriveImageFile } from '@/utils/googleDrive'
import { performOCR, parseOCRToAlbums, matchAlbumsWithCandidates } from '@/utils/discGuideImport'
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

    const nextIndex = startIndex + 1
    if (nextIndex < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      await dispatchDriveImport(discGuideId, folderId, files, nextIndex)
    } else {
      console.log(`Drive画像取込完了(フォルダ${folderId}): ${files.length}件`)
      revalidatePath(`/admin/data/discguides/${discGuideId}`)
    }
  })

  return NextResponse.json({ dispatched: true, total: files.length })
}
