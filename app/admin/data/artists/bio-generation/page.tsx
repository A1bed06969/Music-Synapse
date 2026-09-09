import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import BioGenerationList, { type BioGenerationLogRow } from './BioGenerationList'

export default async function BioGenerationPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('bio_generation_log')
    .select('id, artist_id, artist_name, source_type, generated_bio, created_at')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(200)

  const rows: BioGenerationLogRow[] = (data ?? []).map((r) => ({
    id: r.id,
    artistId: r.artist_id,
    artistName: r.artist_name,
    sourceType: r.source_type as 'article_context' | 'wikidata',
    generatedBio: r.generated_bio,
    createdAt: r.created_at,
  }))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <Link href="/admin/data" className="text-xs text-white/40 hover:text-white/70">
        ← 管理画面に戻る
      </Link>

      <h1 className="mt-4 text-2xl font-bold">アーティスト紹介文の自動生成結果</h1>
      <p className="mt-2 text-sm text-white/50">
        Geminiで自動生成・即時公開された紹介文の一覧です(直近200件)。内容がおかしければ「取り消す」で元の状態(空欄)に戻せます。
      </p>

      <BioGenerationList rows={rows} />
    </div>
  )
}
