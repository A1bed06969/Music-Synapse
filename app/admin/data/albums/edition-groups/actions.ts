'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

function redirectWith(result: 'success' | 'error', message: string): never {
  redirect(`/admin/data/albums/edition-groups?${result}=${encodeURIComponent(message)}`)
}

/** 自動グループ化を誤りと判断した版を、そのグループから外す。以後の自動
 * バックフィルに再び拾われないよう、手動修正フラグを立てる。 */
export async function unlinkEdition(formData: FormData) {
  const albumId = String(formData.get('album_id') ?? '')
  if (!albumId) {
    redirectWith('error', 'アルバムを選択してください。')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('album')
    .update({ primary_album_id: null, edition_group_manual_override: true })
    .eq('id', albumId)

  if (error) {
    redirectWith('error', `グループ解除に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  redirectWith('success', 'グループから外しました。')
}

/** 自動判定で拾われなかった版を、手動で代表版に紐付ける。代表版自身が既に
 * 別の版になっている(primary_album_idを持つ)場合は、多段階のグループに
 * なってしまうため拒否する。 */
export async function linkEdition(formData: FormData) {
  const editionId = String(formData.get('edition_album_id') ?? '')
  const primaryId = String(formData.get('primary_album_id') ?? '')

  if (!editionId || !primaryId || editionId === primaryId) {
    redirectWith('error', '版とその代表版には異なるアルバムを選んでください。')
  }

  const supabase = createAdminClient()

  const { data: primaryAlbum } = await supabase
    .from('album')
    .select('id, primary_album_id')
    .eq('id', primaryId)
    .single()

  if (!primaryAlbum) {
    redirectWith('error', '指定した代表版が見つかりませんでした。')
  }
  if (primaryAlbum!.primary_album_id) {
    redirectWith('error', '指定した代表版は既に別のアルバムの版になっています。そのグループの本来の代表版を指定してください。')
  }

  const { error } = await supabase
    .from('album')
    .update({ primary_album_id: primaryId, edition_group_manual_override: true })
    .eq('id', editionId)

  if (error) {
    redirectWith('error', `紐付けに失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  revalidatePath(`/albums/${primaryId}`)
  redirectWith('success', '版を紐付けました。')
}

/** グループの代表版を、既存の版のうちの1件に差し替える。旧代表版は新代表版の
 * 版になり、それまで旧代表版を指していた他の版も全て新代表版へ付け替わる。 */
export async function changeGroupRepresentative(formData: FormData) {
  const currentPrimaryId = String(formData.get('current_primary_id') ?? '')
  const newPrimaryId = String(formData.get('new_primary_id') ?? '')

  if (!currentPrimaryId || !newPrimaryId || currentPrimaryId === newPrimaryId) {
    redirectWith('error', '現在の代表版と新しい代表版には異なるアルバムを選んでください。')
  }

  const supabase = createAdminClient()

  const { data: newPrimary } = await supabase
    .from('album')
    .select('id, primary_album_id')
    .eq('id', newPrimaryId)
    .single()

  if (!newPrimary || newPrimary.primary_album_id !== currentPrimaryId) {
    redirectWith('error', '指定した新しい代表版は、そのグループの版ではありません。')
  }

  // 新代表版以外の、旧代表版を指していた版たちを新代表版へ付け替える
  const { error: reassignError } = await supabase
    .from('album')
    .update({ primary_album_id: newPrimaryId })
    .eq('primary_album_id', currentPrimaryId)
    .neq('id', newPrimaryId)
  if (reassignError) {
    redirectWith('error', `版の付け替えに失敗しました: ${reassignError.message}`)
  }

  // 旧代表版を新代表版の版にする
  const { error: demoteError } = await supabase
    .from('album')
    .update({ primary_album_id: newPrimaryId })
    .eq('id', currentPrimaryId)
  if (demoteError) {
    redirectWith('error', `旧代表版の更新に失敗しました: ${demoteError.message}`)
  }

  // 新代表版自身をNULLにする(これが代表版になる)
  const { error: promoteError } = await supabase
    .from('album')
    .update({ primary_album_id: null })
    .eq('id', newPrimaryId)
  if (promoteError) {
    redirectWith('error', `新代表版の更新に失敗しました: ${promoteError.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  revalidatePath(`/albums/${currentPrimaryId}`)
  revalidatePath(`/albums/${newPrimaryId}`)
  redirectWith('success', '代表版を変更しました。')
}
