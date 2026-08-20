'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchGoogleBooksCover } from '@/utils/googleBooksApi'

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/discguides?${result}=${encodeURIComponent(message)}`)
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

export async function updateDiscGuideSelection(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  const previousAlbumId = String(formData.get('previous_album_id') ?? '')

  if (!id || !albumId) {
    redirectWith('error', 'アルバムを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('disc_guide_selection')
    .update({ album_id: albumId, note: note || null })
    .eq('id', id)

  if (error) {
    redirectWith('error', `掲載データの更新に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/discguides')
  revalidatePath(`/albums/${albumId}`)
  if (previousAlbumId && previousAlbumId !== albumId) revalidatePath(`/albums/${previousAlbumId}`)
  redirectWith('success', '掲載データを更新しました。')
}

export async function deleteDiscGuideSelection(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const albumId = String(formData.get('album_id') ?? '')

  if (!id) {
    redirectWith('error', '不正なリクエストです。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('disc_guide_selection').delete().eq('id', id)

  if (error) {
    redirectWith('error', `掲載データの削除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/discguides')
  if (albumId) revalidatePath(`/albums/${albumId}`)
  redirectWith('success', '掲載データを削除しました。')
}
