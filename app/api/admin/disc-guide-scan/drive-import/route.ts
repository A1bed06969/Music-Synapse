// DiscGuideDriveImport.tsx(クライアントコンポーネント)から繰り返し呼ばれる、
// Google Driveフォルダ内画像の取込エンドポイント。呼ばれるたびにstartIndexから
// 時間予算いっぱいまで(目安5〜6枚)を前段で処理し、続きがあれば
// { done: false, nextIndex } を返す。クライアント側が結果を見てもう一度この
// エンドポイントを呼ぶ、を繰り返すことで全件処理する。
//
// 元々はサーバーが自分自身をafter()+3〜20秒間隔で再ディスパッチするチャンク方式
// だったが、間隔をどれだけ広げてもVercelのループ検知(HTTP 508)が必ず4回目の
// 自己呼び出しで発火することを本番の89枚一括取込で確認した(公式には「同一関数の
// 4回連続自己呼び出し」が固定閾値: https://community.vercel.com/t/why-vercel-triggers-508-infinite-loop-detected-on-recursive-nuxt-api-calls/37450)。
// 呼び出し元をサーバー自身からブラウザに変えることで、この検知の対象外になる。
//
// 元々はtesseract.js(ローカルOCR)で処理していたが、実際のページで精度・
// レイアウト分割の両方が実用に耐えなかったためGemini APIでの直接構造化
// 抽出に切り替えた(utils/geminiDiscGuideExtract.ts参照)。
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/utils/Supabase/admin'
import { downloadDriveFile, type DriveImageFile } from '@/utils/googleDrive'
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport'
import { extractAlbumsWithGemini } from '@/utils/geminiDiscGuideExtract'

export const maxDuration = 60
// 1バッチあたりの処理時間予算。gemini-3.1-flash-liteは1枚あたり実測5〜6秒程度
// なので、この予算でおおよそ5〜6枚/バッチになる(1枚が長引いても下記の
// 個別タイムアウトで打ち切られるため、予算を超えて居座ることはない)。
const BATCH_TIME_BUDGET_MS = 35_000
// 1枚の処理(ダウンロード+Gemini抽出+リトライ+DB書き込み)がどれだけ時間が
// かかっても、必ずこの時間内で切り上げて次の判定に進む。
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

  const supabase = createAdminClient()
  const batchStartedAt = Date.now()
  let i = startIndex
  let processedCount = 0

  for (; i < files.length; i++) {
    if (i > startIndex && Date.now() - batchStartedAt > BATCH_TIME_BUDGET_MS) break
    const file = files[i]
    try {
      await withTimeout(processOneFile(supabase, discGuideId, file), PROCESS_TIME_BUDGET_MS)
    } catch (err) {
      console.error(`Drive画像の処理に失敗しました(${file.name}):`, err)
    }
    processedCount++
  }

  const done = i >= files.length
  if (done) {
    console.log(`Drive画像取込完了(フォルダ${folderId}): ${files.length}件`)
    revalidatePath(`/admin/data/discguides/${discGuideId}`)
  }

  return NextResponse.json({ processedCount, nextIndex: i, total: files.length, done })
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
