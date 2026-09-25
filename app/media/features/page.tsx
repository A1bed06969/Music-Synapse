import { createClient } from '@/utils/Supabase/server'
import FeaturesPageClient, { type RankingCard } from './FeaturesPageClient'
import { getRankingPreview } from './actions'

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function MediaFeaturesPage() {
  const supabase = await createClient()

  const { data: rankings } = await supabase
    .from('ranking')
    .select('id, name, source, description, list_type, image_url, media:media_id(id, name)')
    .order('id', { ascending: false })

  const cards: RankingCard[] = (rankings ?? []).map((r) => {
    const media = firstOf(r.media)
    return {
      id: r.id,
      name: r.name,
      mediaName: media?.name ?? r.source ?? null,
      description: r.description,
      imageUrl: r.image_url,
      listType: r.list_type,
    }
  })

  // 空状態を避けるため、最新の企画(先頭)のプレビューをサーバー側で先読みして
  // 右カラムの初期表示に渡す(クリックで選び直した以降はクライアント側で取得)
  const initialPreview = cards.length > 0 ? await getRankingPreview(cards[0].id) : null

  return <FeaturesPageClient cards={cards} initialPreview={initialPreview} />
}
