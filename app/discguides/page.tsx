import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

export default async function DiscGuidesPage() {
  const supabase = await createClient()

  const [{ data: guides }, { data: selections }] = await Promise.all([
    supabase
      .from('disc_guide')
      .select('id, title, publisher, published_year, cover_image_url')
      .order('title'),
    supabase.from('disc_guide_selection').select('disc_guide_id'),
  ])

  const albumCountByGuideId = new Map<string, number>()
  for (const row of selections ?? []) {
    albumCountByGuideId.set(row.disc_guide_id, (albumCountByGuideId.get(row.disc_guide_id) ?? 0) + 1)
  }

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">ディスクガイド</h1>
      <p className="mt-2 text-sm text-white/50">掲載アルバムを収録したディスクガイド本の一覧。</p>

      {!guides || guides.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">ディスクガイドが登録されていません。</p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {guides.map((guide) => {
            const meta = [guide.publisher, guide.published_year ? `${guide.published_year}年` : null]
              .filter(Boolean)
              .join(' / ')
            const albumCount = albumCountByGuideId.get(guide.id) ?? 0
            return (
              <li key={guide.id}>
                <Link href={`/discguides/${guide.id}`} className="group block">
                  <div className="aspect-[3/4] overflow-hidden rounded-md border border-white/10 bg-white/5">
                    {guide.cover_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={guide.cover_image_url}
                        alt={guide.title}
                        className="h-full w-full object-cover transition group-hover:opacity-80"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl">📚</div>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium group-hover:opacity-70">{guide.title}</p>
                  <p className="text-xs text-white/40">
                    {meta}
                    {meta && albumCount > 0 ? ' · ' : ''}
                    {albumCount > 0 ? `掲載${albumCount}件` : ''}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
