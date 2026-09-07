import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

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

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">キュレーションコンテンツ</h1>
      <p className="mt-2 text-sm text-white/50">音楽誌・メディア独自の企画コンテンツをアーカイブしています。</p>

      {!rankings || rankings.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">まだ企画コンテンツが登録されていません。</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {rankings.map((r) => {
            const media = firstOf(r.media)
            return (
              <Link
                key={r.id}
                href={`/media/features/${r.id}`}
                className="flex gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
              >
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-white/5">
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl text-white/20">🎵</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-white/40">{media?.name ?? r.source ?? 'メディア企画'}</p>
                    <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                      {r.list_type === 'selection' ? '選出' : 'ランキング'}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold">{r.name}</p>
                  {r.description && <p className="mt-1 text-xs text-white/50">{r.description}</p>}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
