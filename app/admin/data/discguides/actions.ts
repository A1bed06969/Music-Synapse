'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchGoogleBooksCover } from '@/utils/googleBooksApi'
import { listImagesInFolder } from '@/utils/googleDrive'
import { dispatchDriveImport } from '@/utils/discGuideDriveDispatch'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/discguides?${result}=${encodeURIComponent(message)}`)
}

/** フォルダURL(https://drive.google.com/drive/folders/XXXXX の形)または
 * フォルダIDそのものの入力を受け付け、フォルダIDだけを取り出す */
function extractDriveFolderId(input: string): string {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]
  return trimmed
}

/** Google Driveフォルダ内の画像を、既存のディスクガイドOCRパイプライン
 * (アップロード式と全く同じdisc_guide_scan_pending)に読み込む。1件ずつのOCR処理は
 * チャンク分割してバックグラウンドで進む(utils/discGuideDriveDispatch.ts参照) */
export async function startDriveImport(formData: FormData) {
  const discGuideId = String(formData.get('disc_guide_id') ?? '')
  const folderInput = String(formData.get('folder_url') ?? '').trim()

  if (!discGuideId || !folderInput) {
    redirectWith('error', '書籍とDriveフォルダを指定してください。')
  }

  const folderId = extractDriveFolderId(folderInput)

  let files
  try {
    files = await listImagesInFolder(folderId)
  } catch (err) {
    redirectWith('error', `Driveフォルダの読み取りに失敗しました: ${(err as Error).message}`)
    return
  }

  if (files.length === 0) {
    redirectWith('error', '指定フォルダに画像が見つかりませんでした(共有設定もご確認ください)。')
    return
  }

  after(() => dispatchDriveImport(discGuideId, folderId, files, 0))

  revalidatePath('/admin/data/discguides')
  redirectWith('success', `Driveフォルダから${files.length}件の画像を検出、読み取りを開始しました。`)
}

export async function createDiscGuide(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  const publisher = String(formData.get('publisher') ?? '').trim()
  const publishedYearRaw = String(formData.get('published_year') ?? '').trim()
  const isbn = String(formData.get('isbn') ?? '').trim()

  if (!title) {
    redirectWith('error', '書籍名を入力してください。')
  }

  const supabase = createAdminClient()
  const { data: inserted, error } = await supabase
    .from('disc_guide')
    .insert({
      title,
      publisher: publisher || null,
      published_year: publishedYearRaw ? Number(publishedYearRaw) : null,
      isbn: isbn || null,
    })
    .select('id')
    .single()

  if (error) {
    redirectWith('error', `書籍の登録に失敗しました: ${error.message}`)
  }

  // 表紙画像を Google Books API から取得する。ISBN 検索は外部 API 待ちになるため
  // レスポンスをブロックせず after() で実行する。対象は今 insert した行の id 限定
  // (ISBN で絞ると同一 ISBN の別レコードまで巻き込むため)。
  const discGuideId: string | undefined = inserted?.id
  if (isbn && discGuideId) {
    after(async () => {
      try {
        const result = await fetchGoogleBooksCover(isbn)
        if (result.coverUrl) {
          await supabase
            .from('disc_guide')
            .update({
              cover_image_url: result.coverUrl,
              cover_image_fetched_at: new Date().toISOString(),
              isbn_lookup_error: null,
            })
            .eq('id', discGuideId)
        } else {
          // レート制限は一時的な状態であり「この本には表紙が無い」とは異なるため、
          // 管理画面で区別できるようメッセージを分ける。
          const message =
            result.error === 'rate_limited'
              ? 'Google Books APIのレート制限に達しました(後で再試行してください)'
              : result.error === 'network_error'
                ? 'Google Books APIへの接続に失敗しました'
                : '表紙画像が見つかりませんでした'
          await supabase
            .from('disc_guide')
            .update({ isbn_lookup_error: message })
            .eq('id', discGuideId)
        }
      } catch (err) {
        await supabase
          .from('disc_guide')
          .update({ isbn_lookup_error: (err as Error).message })
          .eq('id', discGuideId)
      }
    })
  }

  revalidatePath('/admin/data/discguides')
  redirectWith('success', `「${title}」を登録しました。`)
}

export async function createDiscGuideSelection(formData: FormData) {
  const discGuideId = String(formData.get('disc_guide_id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!discGuideId || !albumId) {
    redirectWith('error', '書籍とアルバムを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('disc_guide_selection').insert({
    disc_guide_id: discGuideId,
    album_id: albumId,
    note: note || null,
  })

  if (error) {
    redirectWith('error', `掲載データの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/discguides')
  revalidatePath(`/albums/${albumId}`)
  redirectWith('success', '掲載データを登録しました。')
}
