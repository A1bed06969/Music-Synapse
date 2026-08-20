'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchTowerProductInfo } from '@/utils/towerRecords'

function redirectWith(albumId: string, result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/${albumId}/tower-lookup?${result}=${encodeURIComponent(message)}`)
}

export async function applyTowerLookup(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const towerUrl = String(formData.get('tower_url') ?? '').trim()

  if (!albumId || !towerUrl) {
    redirect('/admin/data')
  }

  let info
  try {
    info = await fetchTowerProductInfo(towerUrl)
  } catch (err) {
    redirectWith(albumId, 'error', `取得に失敗しました: ${(err as Error).message}`)
  }

  if (!info.imageUrl && !info.releaseDate && !info.labelName) {
    redirectWith(albumId, 'error', '商品ページから情報を読み取れませんでした。URLをご確認ください。')
  }

  const supabase = createAdminClient()

  let labelId: string | undefined
  if (info.labelName) {
    const { data: existingLabel } = await supabase
      .from('label')
      .select('id')
      .eq('name', info.labelName)
      .maybeSingle()

    if (existingLabel) {
      labelId = existingLabel.id
    } else {
      const { data: newLabel, error: labelError } = await supabase
        .from('label')
        .insert({ name: info.labelName })
        .select('id')
        .single()
      if (labelError) {
        console.error(`レーベルの登録に失敗しました("${info.labelName}"):`, labelError.message)
      } else {
        labelId = newLabel?.id
      }
    }
  }

  const update: Record<string, unknown> = {}
  if (info.imageUrl) update.jacket_url = info.imageUrl
  if (info.releaseDate) update.release_date = info.releaseDate
  if (labelId) update.label_id = labelId

  const { error: updateError } = await supabase.from('album').update(update).eq('id', albumId)

  if (updateError) {
    redirectWith(albumId, 'error', `更新に失敗しました: ${updateError.message}`)
  }

  revalidatePath(`/albums/${albumId}`)
  revalidatePath(`/admin/data/albums/${albumId}/tower-lookup`)
  redirectWith(albumId, 'success', 'Tower Recordsの情報を反映しました。')
}
