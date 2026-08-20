// utils/discGuideDriveDispatch.tsからのみ叩かれる内部専用エンドポイント。
// Google Driveフォルダ内の画像を1回の呼び出しにつき1枚だけGeminiで抽出し、
// 続きを自分自身に再ディスパッチする(理由・ホップ間遅延の必要性は
// app/api/admin/album-sync/route.tsのコメント参照)。
//
// 元々はtesseract.js(ローカルOCR)で処理していたが、実際のページで精度・
// レイアウト分割の両方が実用に耐えなかったためGemini APIでの直接構造化
// 抽出に切り替えた(utils/geminiDiscGuideExtract.ts参照)。1呼び出し1枚に
// 固定しているのは実行時間対策ではなく、Gemini無料枠の呼び出し回数制限
// (分間・日次)を超えないよう、既存のホップ間隔でペース配分するため。
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { downloadDriveFile, type DriveImageFile } from '@/utils/googleDrive'
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport'
import { extractAlbumsWithGemini } from '@/utils/geminiDiscGuideExtract'
import { dispatchDriveImport } from '@/utils/discGuideDriveDispatch'

export const maxDuration = 60
// 1枚の処理(ダウンロード+Gemini抽出+リトライ+DB書き込み)にどれだけ時間が
// かかっても、必ずこの時間内で切り上げて次への引き継ぎ(redispatch)に進む。
// これを設けずリトライの合計待ち時間がmaxDuration(60秒)に迫った結果、
// 「Vercel Runtime Timeout Error」で関数ごと強制終了されチェーン全体が無言で
// 停止する不具合が本番の89枚一括取込で実際に発生した。after()はトリガーとなった
// リクエストと同じmaxDuration予算を共有するため、ホップ間隔(20秒、下記)を
// 差し引いても60秒に収まるよう30秒に設定する。
const PROCESS_TIME_BUDGET_MS = 30_000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`処理が${ms}ms以内に完了しませんでした`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

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
        await withTimeout(processOneFile(supabase, discGuideId, file), PROCESS_TIME_BUDGET_MS)
      } catch (err) {
        console.error(`Drive画像の処理に失敗しました(${file.name}):`, err)
      }
    }

    const nextIndex = startIndex + 1
    if (nextIndex < files.length) {
      // Vercelのループ検知(508)は、ホップ間隔を数秒〜数十秒空けても「同じURLへの
      // 自己再ディスパッチが短時間に一定回数を超えた」だけで発火することを本番の
      // 89枚一括取込で確認した(6秒間隔でも4ホップ目で毎回発火)。間隔ではなく
      // 単位時間あたりのホップ数を下げる必要があるため、20秒まで広げる。
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await dispatchDriveImport(discGuideId, folderId, files, nextIndex)
    } else {
      console.log(`Drive画像取込完了(フォルダ${folderId}): ${files.length}件`)
      revalidatePath(`/admin/data/discguides/${discGuideId}`)
    }
  })

  return NextResponse.json({ dispatched: true, total: files.length })
}

async function processOneFile(
  supabase: ReturnType<typeof createAdminClient>,
  discGuideId: string,
  file: DriveImageFile
): Promise<void> {
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
}
