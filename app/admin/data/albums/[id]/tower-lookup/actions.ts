'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchTowerProductInfo } from '@/utils/towerRecords'

function redirectWith(albumId: string, result: 'success' | 'error', message: string, from?: string): never {
  const params = new URLSearchParams({ [result]: message })
  if (from) params.set('from', from)
  redirect(`/admin/data/albums/${albumId}/tower-lookup?${params.toString()}`)
}

export async function applyTowerLookup(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  const towerUrl = String(formData.get('tower_url') ?? '').trim()
  const from = String(formData.get('from') ?? '') || undefined

  if (!albumId || !towerUrl) {
    redirect('/admin/data')
  }

  let info
  try {
    info = await fetchTowerProductInfo(towerUrl)
  } catch (err) {
    redirectWith(albumId, 'error', `取得に失敗しました: ${(err as Error).message}`, from)
  }

  if (!info.imageUrl && !info.releaseDate && !info.labelName && info.tracks.length === 0) {
    redirectWith(albumId, 'error', '商品ページから情報を読み取れませんでした。URLをご確認ください。', from)
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

  // tower_urlは画像が取れた場合のみ保存する。画像抽出だけ失敗した状態で
  // tower_urlを保存すると、「未マッチ」判定(album.tower_url is null)から
  // ジャケット無しのまま静かに外れてしまうため(release_date/label/tracksは
  // 取れた分だけそのまま反映し、次の確認のためにURLの再入力を促す)
  const update: Record<string, unknown> = {}
  if (info.imageUrl) {
    update.tower_url = towerUrl
    update.jacket_url = info.imageUrl
  }
  if (info.releaseDate) update.release_date = info.releaseDate
  if (labelId) update.label_id = labelId

  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabase.from('album').update(update).eq('id', albumId)

    if (updateError) {
      redirectWith(albumId, 'error', `更新に失敗しました: ${updateError.message}`, from)
    }
  }

  // 既にトラックが登録されている場合は重複作成を避けるため、まだ1件も無いときだけ
  // Tower Recordsの収録内容から取り込む(iTunes経由の登録と違いプレビュー音源・
  // トラックIDは無いため、あくまで曲名・トラック番号のみの手がかり)
  let tracksAdded = 0
  if (info.tracks.length > 0) {
    const { count: existingTrackCount } = await supabase
      .from('track')
      .select('id', { count: 'exact', head: true })
      .eq('album_id', albumId)

    if (!existingTrackCount) {
      const { data: albumArtist } = await supabase.from('album').select('artist_id').eq('id', albumId).single()
      const { error: trackError } = await supabase.from('track').insert(
        info.tracks.map((t) => ({
          album_id: albumId,
          artist_id: albumArtist?.artist_id ?? null,
          track_no: t.trackNo,
          disc_number: t.discNumber,
          title: t.title,
        }))
      )
      if (trackError) {
        console.error(`トラックの登録に失敗しました(album_id=${albumId}):`, trackError.message)
      } else {
        tracksAdded = info.tracks.length
      }
    }
  }

  revalidatePath(`/albums/${albumId}`)
  revalidatePath(`/admin/data/albums/${albumId}/tower-lookup`)

  if (!info.imageUrl) {
    redirectWith(
      albumId,
      'error',
      `ジャケット画像は見つかりませんでした(発売日・レーベル等、取得できた項目のみ反映しました)。未マッチ扱いのまま残ります。`,
      from
    )
  }

  redirectWith(
    albumId,
    'success',
    `Tower Recordsの情報を反映しました。${tracksAdded > 0 ? `(トラック${tracksAdded}件を追加)` : ''}`,
    from
  )
}
