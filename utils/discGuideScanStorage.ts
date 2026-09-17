import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'disc-guide-scans'

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/heif': 'heif',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** ディスクガイドのスキャン画像をSupabase Storageへアップロードし、公開URLを返す。
 * 以前はbase64データを`disc_guide_scan_pending.image_url`へ直接埋め込んでおり、
 * 198行だけでDB容量の32%(645MB)を消費する事故につながった(2026-09-17修正)。
 * 画像本体は必ずStorageへ、DBにはURLのみを保存する。 */
export async function uploadDiscGuideScanImage(
  supabase: SupabaseClient,
  discGuideId: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ url: string | null; errorMessage: string | null }> {
  const extension = EXTENSION_BY_MIME_TYPE[mimeType] ?? 'bin'
  const path = `${discGuideId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  })
  if (uploadError) {
    return { url: null, errorMessage: uploadError.message }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, errorMessage: null }
}
