import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'

const MEDIA_TYPE_LABEL: Record<string, string> = {
  radio: 'ラジオ局',
  tv: 'テレビ',
  magazine: '雑誌',
  web: 'Webメディア',
}

export default async function MediaHubPage({
  searchParams,
}: {
  searchParams: Promise<{ media_type?: string; area?: string }>
}) {
  const { media_type: mediaType, area } = await searchParams
  const supabase = await createClient()

  const { data: allMedia } = await supabase.from('media').select('id, name, media_type, area, prefecture, logo_url')

  const areas = Array.from(new Set((allMedia ?? []).map((m) => m.area).filter(Boolean))) as string[]

  let mediaList = allMedia ?? []
  if (mediaType) mediaList = mediaList.filter((m) => m.media_type === mediaType)
  if (area) mediaList = mediaList.filter((m) => m.area === area)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-12">
      <h1 className="text-2xl font-bold">メディア&パワープレイ</h1>
      <p className="mt-2 text-sm text-white/50">全国のメディア・番組からパワープレイ・企画・タイアップ実績を発見できます。</p>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link href="/media/on-air" className="rounded-full border border-white/15 px-4 py-1.5 hover:bg-white/5">
          📻 パワープレイ&ヘビロテ
        </Link>
        <Link href="/media/features" className="rounded-full border border-white/15 px-4 py-1.5 hover:bg-white/5">
          🧭 キュレーションコンテンツ
        </Link>
        <Link href="/media/sync" className="rounded-full border border-white/15 px-4 py-1.5 hover:bg-white/5">
          🎬 タイアップ・シンクロアーカイブ
        </Link>
      </div>

      <form className="mt-8 flex flex-wrap gap-2" action="/media">
        <select
          name="media_type"
          defaultValue={mediaType ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">種別: すべて</option>
          {Object.entries(MEDIA_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="area"
          defaultValue={area ?? ''}
          className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
        >
          <option value="">エリア: すべて</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85"
        >
          絞り込む
        </button>
      </form>

      {mediaList.length === 0 ? (
        <p className="mt-10 text-sm text-white/40">該当するメディアが登録されていません。</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {mediaList.map((m) => (
            <Link
              key={m.id}
              href={`/media/on-air?media=${m.id}`}
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-center transition hover:bg-white/[0.06]"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-lg">
                {m.media_type === 'radio' ? '📻' : m.media_type === 'tv' ? '📺' : m.media_type === 'web' ? '💻' : '📖'}
              </div>
              <p className="mt-3 truncate text-sm font-medium">{m.name}</p>
              <p className="mt-0.5 text-xs text-white/40">
                {m.media_type ? MEDIA_TYPE_LABEL[m.media_type] ?? m.media_type : ''}
                {m.area ? ` · ${m.area}` : ''}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
