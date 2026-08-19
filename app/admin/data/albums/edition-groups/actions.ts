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

  // 紐付けようとしている版が、既に他のアルバムから代表版として参照されている
  // (=自分自身の版を持っている)場合、そのままだと多段階のグループになってしまう
  // (子アルバムたちが一覧・詳細ページから見えなくなる静かなデータ消失につながる)ため拒否する。
  const { data: editionChildren } = await supabase.from('album').select('id').eq('primary_album_id', editionId).limit(1)
  if (editionChildren && editionChildren.length > 0) {
    redirectWith('error', '指定した版は既に他のアルバムの代表版になっています。先にそちらのグループを解消してから紐付けてください。')
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

  // 3段階の更新は1トランザクションではないため、途中で失敗しても手動修正可能な
  // 安全な状態(=代表版が2つに分かれるだけ)で止まるよう、必ずこの順序で実行すること。
  // 「新代表版を先に昇格 → 版たちの付け替え → 旧代表版を降格」の順にすることで、
  // どの段階で失敗しても「旧代表版→新代表版→旧代表版」のような循環参照が
  // 決して発生しない(旧代表版と新代表版がそれぞれ独立した代表版のまま止まるだけ)。

  // 新代表版自身をまずNULLにする(これが代表版になる)。手動修正フラグも立てる
  // (unlinkEdition/linkEditionと同様、以後の自動バックフィルに再び拾われないように)。
  const { error: promoteError } = await supabase
    .from('album')
    .update({ primary_album_id: null, edition_group_manual_override: true })
    .eq('id', newPrimaryId)
  if (promoteError) {
    redirectWith('error', `新代表版の更新に失敗しました: ${promoteError.message}`)
  }

  // 旧代表版を指していた版たちを新代表版へ付け替える。新代表版は直前の更新で
  // 既にprimary_album_id=NULLになっているため、この時点でWHERE句には一致せず、
  // 自分自身を指してしまう心配はない(.neq()による除外が不要になった)。
  const { error: reassignError } = await supabase
    .from('album')
    .update({ primary_album_id: newPrimaryId })
    .eq('primary_album_id', currentPrimaryId)
  if (reassignError) {
    redirectWith('error', `版の付け替えに失敗しました: ${reassignError.message}`)
  }

  // 最後に旧代表版を新代表版の版にする。旧代表版自身は上の付け替えクエリの対象外
  // (旧代表版のprimary_album_idはNULLであり、currentPrimaryIdと一致しない)なので、
  // ここで確実に新代表版へ紐付ける。手動修正フラグも立てる(linkEditionが版にする際と同様)。
  const { error: demoteError } = await supabase
    .from('album')
    .update({ primary_album_id: newPrimaryId, edition_group_manual_override: true })
    .eq('id', currentPrimaryId)
  if (demoteError) {
    redirectWith('error', `旧代表版の更新に失敗しました: ${demoteError.message}`)
  }

  revalidatePath('/admin/data/albums/edition-groups')
  revalidatePath(`/albums/${currentPrimaryId}`)
  revalidatePath(`/albums/${newPrimaryId}`)
  redirectWith('success', '代表版を変更しました。')
}
