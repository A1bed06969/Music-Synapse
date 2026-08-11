'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/utils/Supabase/admin'

const RELATION_STYLE_BY_TYPE: Record<string, 'solid' | 'dotted'> = {
  membership: 'solid',
  production: 'solid',
  collaboration: 'solid',
  genre_scene: 'dotted',
  influence: 'dotted',
  sync_costar: 'dotted',
}

function redirectWith(result: 'success' | 'error', message: string) {
  redirect(`/admin/data/relations?${result}=${encodeURIComponent(message)}`)
}

export async function createRelation(formData: FormData) {
  const artistIdA = String(formData.get('artist_id_a') ?? '')
  const artistIdB = String(formData.get('artist_id_b') ?? '')
  const relationType = String(formData.get('relation_type') ?? '')
  const description = String(formData.get('description') ?? '').trim()

  if (!artistIdA || !artistIdB || !relationType) {
    redirectWith('error', 'アーティスト2件と関係の種類を選択してください。')
  }
  if (artistIdA === artistIdB) {
    redirectWith('error', '異なる2人のアーティストを選択してください。')
  }

  const relationStyle = RELATION_STYLE_BY_TYPE[relationType]

  const [artist_id_a, artist_id_b] = [artistIdA, artistIdB].sort()

  const supabase = createAdminClient()
  const { error } = await supabase.from('artist_relation').upsert(
    {
      artist_id_a,
      artist_id_b,
      relation_type: relationType,
      relation_style: relationStyle,
      description: description || null,
    },
    { onConflict: 'artist_id_a,artist_id_b,relation_type', ignoreDuplicates: true }
  )

  if (error) {
    redirectWith('error', `相関データの登録に失敗しました: ${error.message}`)
  }

  revalidatePath('/admin/data/relations')
  revalidatePath('/relations')
  redirectWith('success', '相関データを登録しました。')
}
