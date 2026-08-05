import Link from 'next/link'
import { createClient } from '@/utils/Supabase/server'
import { PREFECTURE_COORDS } from '@/utils/prefectures'
import {
  createGenre,
  linkArtistGenre,
  createRelation,
  createLabel,
  linkArtistLabel,
  linkAlbumLabel,
  createMedia,
  createMediaProgram,
  createRadioRotation,
  createRanking,
  createRankingEntry,
  createSyncWork,
  createSyncEntry,
} from './actions'

const RELATION_TYPE_OPTIONS = [
  { value: 'membership', label: '在籍・メンバー(実線)' },
  { value: 'production', label: '制作(実線)' },
  { value: 'collaboration', label: 'コラボ(実線)' },
  { value: 'genre_scene', label: 'ジャンル・シーン(点線)' },
  { value: 'influence', label: '影響関係(点線)' },
  { value: 'sync_costar', label: 'タイアップ共演(点線)' },
]

const MEDIA_TYPE_OPTIONS = [
  { value: 'radio', label: 'ラジオ' },
  { value: 'tv', label: 'テレビ' },
  { value: 'magazine', label: '雑誌' },
  { value: 'web', label: 'Web' },
]

const PERIOD_TYPE_OPTIONS = [
  { value: 'weekly', label: '週間' },
  { value: 'monthly', label: '月間' },
]

const MUSIC_TYPE_OPTIONS = [
  { value: 'DOMESTIC', label: '邦楽' },
  { value: 'OVERSEAS', label: '洋楽' },
]

const WORK_TYPE_OPTIONS = [
  { value: 'cm', label: 'CM' },
  { value: 'anime', label: 'アニメ' },
  { value: 'game', label: 'ゲーム' },
  { value: 'movie', label: '映画' },
  { value: 'tv_program', label: 'テレビ番組' },
]

const inputClass =
  'w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/30 focus:outline-none'
const buttonClass =
  'rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85'

export default async function AdminDataPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>
}) {
  const { success, error } = await searchParams
  const supabase = await createClient()

  const [
    { data: artists },
    { data: genres },
    { data: labels },
    { data: albums },
    { data: tracks },
    { data: mediaList },
    { data: mediaPrograms },
    { data: artistGenres },
    { data: relations },
    { data: artistLabels },
    { data: albumLabels },
    { data: rotations },
    { data: rankings },
    { data: rankingEntries },
    { data: syncWorks },
    { data: syncEntries },
  ] = await Promise.all([
    supabase.from('artist').select('id, name').order('name'),
    supabase.from('genre').select('id, name').order('name'),
    supabase.from('label').select('id, name').order('name'),
    supabase.from('album').select('id, title, artist:artist_id(name)').order('title'),
    supabase.from('track').select('id, title, artist:artist_id(name)').order('title'),
    supabase.from('media').select('id, name, area').order('name'),
    supabase.from('media_program').select('id, program_name, period_type, media:media_id(name)').order('program_name'),
    supabase
      .from('artist_genre')
      .select('artist:artist_id(name), genre:genre_id(name)')
      .order('artist_id'),
    supabase
      .from('artist_relation')
      .select('id, relation_type, relation_style, description, artist_a:artist_id_a(name), artist_b:artist_id_b(name)')
      .order('id', { ascending: false }),
    supabase
      .from('artist_label')
      .select('artist:artist_id(name), label:label_id(name), start_date')
      .order('artist_id'),
    supabase
      .from('album')
      .select('title, label:label_id(name)')
      .not('label_id', 'is', null)
      .order('title'),
    supabase
      .from('radio_rotation')
      .select(
        'id, period_type, period_start_date, music_type, note, media_program:media_program_id(program_name, media:media_id(name)), track:track_id(title), album:album_id(title), artist:artist_id(name)'
      )
      .order('period_start_date', { ascending: false }),
    supabase.from('ranking').select('id, name, source, media:media_id(name)').order('name'),
    supabase
      .from('ranking_entry')
      .select(
        'id, rank, ranking:ranking_id(name), track:track_id(title), album:album_id(title), artist:artist_id(name)'
      )
      .order('id', { ascending: false }),
    supabase.from('sync_work').select('id, title, work_type, year').order('title'),
    supabase
      .from('sync_entry')
      .select('id, usage_detail, sync_work:sync_work_id(title), track:track_id(title)')
      .order('id', { ascending: false }),
  ])

  const artistOptions = artists ?? []
  const genreOptions = genres ?? []
  const labelOptions = labels ?? []
  const albumOptions = albums ?? []
  const trackOptions = tracks ?? []
  const mediaOptions = mediaList ?? []
  const mediaProgramOptions = mediaPrograms ?? []
  const rankingOptions = rankings ?? []
  const syncWorkOptions = syncWorks ?? []

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">手動データ登録</h1>
        <Link href="/admin/import" className="text-xs text-white/40 hover:text-white/70">
          iTunes一括登録へ →
        </Link>
      </div>
      <p className="mt-2 text-sm text-white/50">
        ジャンル・相関図・レーベルなど、自動同期できない編集データをここから登録します。
      </p>

      {success && (
        <div className="mt-6 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">{success}</div>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm">{error}</div>
      )}

      {/* ジャンル */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">ジャンル</h2>

        <form action={createGenre} className="mt-4 flex flex-wrap gap-2">
          <input name="name" placeholder="ジャンル名(例: シティポップ)" required className={`${inputClass} max-w-xs`} />
          <input name="origin_year" type="number" placeholder="発祥年(任意)" className={`${inputClass} max-w-[140px]`} />
          <button type="submit" className={buttonClass}>
            ジャンルを追加
          </button>
        </form>

        <form action={linkArtistGenre} className="mt-4 flex flex-wrap items-center gap-2">
          <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アーティストを選択
            </option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">に</span>
          <select name="genre_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              ジャンルを選択
            </option>
            {genreOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">を紐付け</span>
          <button type="submit" className={buttonClass}>
            紐付ける
          </button>
        </form>

        {artistGenres && artistGenres.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {artistGenres.map((row, i) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              const genre = Array.isArray(row.genre) ? row.genre[0] : row.genre
              return (
                <li key={i}>
                  {artist?.name} — {genre?.name}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 相関図 */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">相関図データ</h2>

        <form action={createRelation} className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select name="artist_id_a" required className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="" disabled>
                アーティストA
              </option>
              {artistOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select name="artist_id_b" required className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="" disabled>
                アーティストB
              </option>
              {artistOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select name="relation_type" required className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="" disabled>
                関係の種類
              </option>
              {RELATION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <input name="description" placeholder="説明(任意。例: 同じレーベル在籍)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            相関を追加
          </button>
        </form>

        {relations && relations.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {relations.map((row) => {
              const a = Array.isArray(row.artist_a) ? row.artist_a[0] : row.artist_a
              const b = Array.isArray(row.artist_b) ? row.artist_b[0] : row.artist_b
              return (
                <li key={row.id}>
                  {a?.name} {row.relation_style === 'dotted' ? '┄' : '─'} {b?.name}
                  <span className="text-white/30"> ({row.relation_type}{row.description ? `: ${row.description}` : ''})</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* レーベル */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-lg font-semibold">レーベル</h2>

        <form action={createLabel} className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input name="name" placeholder="レーベル名" required className={`${inputClass} max-w-xs`} />
            <input name="name_kana" placeholder="ふりがな(任意)" className={`${inputClass} max-w-xs`} />
            <input name="founded_year" type="number" placeholder="設立年(任意)" className={`${inputClass} max-w-[140px]`} />
          </div>
          <input name="description" placeholder="概要(任意)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            レーベルを追加
          </button>
        </form>

        <form action={linkArtistLabel} className="mt-4 flex flex-wrap items-center gap-2">
          <select name="artist_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アーティストを選択
            </option>
            {artistOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">を</span>
          <select name="label_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              レーベルを選択
            </option>
            {labelOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input name="start_date" type="date" className={`${inputClass} max-w-[160px]`} />
          <button type="submit" className={buttonClass}>
            所属を追加
          </button>
        </form>

        {artistLabels && artistLabels.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {artistLabels.map((row, i) => {
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              const label = Array.isArray(row.label) ? row.label[0] : row.label
              return (
                <li key={i}>
                  {artist?.name} — {label?.name}
                </li>
              )
            })}
          </ul>
        )}

        <form action={linkAlbumLabel} className="mt-6 flex flex-wrap items-center gap-2">
          <select name="album_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              アルバムを選択
            </option>
            {albumOptions.map((a) => {
              const artist = Array.isArray(a.artist) ? a.artist[0] : a.artist
              return (
                <option key={a.id} value={a.id}>
                  {a.title}
                  {artist?.name ? ` — ${artist.name}` : ''}
                </option>
              )
            })}
          </select>
          <span className="text-xs text-white/40">を</span>
          <select name="label_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              レーベルを選択
            </option>
            {labelOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            アルバムを紐付け
          </button>
        </form>

        {albumLabels && albumLabels.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {albumLabels.map((row, i) => {
              const label = Array.isArray(row.label) ? row.label[0] : row.label
              return (
                <li key={i}>
                  {row.title} — {label?.name}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* メディア&オンエア */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">メディア&オンエア</h2>
          <Link href="/media/on-air" className="text-xs text-white/40 hover:text-white/70">
            公開ページを見る →
          </Link>
        </div>

        <form action={createMedia} className="mt-4 flex flex-wrap gap-2">
          <input name="name" placeholder="メディア名(例: FM802)" required className={`${inputClass} max-w-xs`} />
          <select name="media_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">種別(任意)</option>
            {MEDIA_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input name="area" placeholder="エリア(任意。例: 関西)" className={`${inputClass} max-w-[160px]`} />
          <select name="prefecture" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">都道府県(任意)</option>
            {PREFECTURE_COORDS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            メディアを追加
          </button>
        </form>

        <form action={createMediaProgram} className="mt-4 flex flex-wrap gap-2">
          <select name="media_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              メディアを選択
            </option>
            {mediaOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.area ? `(${m.area})` : ''}
              </option>
            ))}
          </select>
          <input name="program_name" placeholder="番組・企画名(例: ヘビーローテーション)" required className={`${inputClass} max-w-xs`} />
          <select name="period_type" required className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="" disabled>
              集計周期
            </option>
            {PERIOD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            番組を追加
          </button>
        </form>

        <p className="mt-6 text-xs text-white/40">
          プッシュ対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。
        </p>
        <form action={createRadioRotation} className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select name="media_program_id" required className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="" disabled>
                番組を選択
              </option>
              {mediaProgramOptions.map((p) => {
                const media = Array.isArray(p.media) ? p.media[0] : p.media
                return (
                  <option key={p.id} value={p.id}>
                    {media?.name} — {p.program_name}
                  </option>
                )
              })}
            </select>
            <select name="period_type" required className={`${inputClass} max-w-[120px]`} defaultValue="">
              <option value="" disabled>
                周期
              </option>
              {PERIOD_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input name="period_start_date" type="date" required className={`${inputClass} max-w-[160px]`} />
            <select name="music_type" required className={`${inputClass} max-w-[120px]`} defaultValue="">
              <option value="" disabled>
                邦楽/洋楽
              </option>
              {MUSIC_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <select name="track_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(トラック指定なし)</option>
              {trackOptions.map((t) => {
                const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
                return (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {artist?.name ? ` — ${artist.name}` : ''}
                  </option>
                )
              })}
            </select>
            <select name="album_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(アルバム指定なし)</option>
              {albumOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <select name="artist_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(アーティスト指定なし)</option>
              {artistOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <input name="note" placeholder="メモ(任意)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            オンエアデータを追加
          </button>
        </form>

        {rotations && rotations.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {rotations.map((row) => {
              const program = Array.isArray(row.media_program) ? row.media_program[0] : row.media_program
              const media = program ? (Array.isArray(program.media) ? program.media[0] : program.media) : null
              const track = Array.isArray(row.track) ? row.track[0] : row.track
              const album = Array.isArray(row.album) ? row.album[0] : row.album
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              const target = track?.title ?? album?.title ?? artist?.name
              return (
                <li key={row.id}>
                  {row.period_start_date} {media?.name} {program?.program_name} — {target}
                  <span className="text-white/30"> ({row.music_type === 'DOMESTIC' ? '邦楽' : '洋楽'})</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* キュレーションコンテンツ */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">キュレーションコンテンツ</h2>
          <Link href="/media/features" className="text-xs text-white/40 hover:text-white/70">
            公開ページを見る →
          </Link>
        </div>

        <form action={createRanking} className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input name="name" placeholder="企画名(例: 最注目新人100)" required className={`${inputClass} max-w-xs`} />
            <select name="media_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">出典メディア(任意)</option>
              {mediaOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input name="source" placeholder="出典(メディア未登録の場合の自由記述)" className={`${inputClass} max-w-xs`} />
          </div>
          <input name="description" placeholder="概要(任意)" className={inputClass} />
          <button type="submit" className={buttonClass}>
            企画を追加
          </button>
        </form>

        <p className="mt-6 text-xs text-white/40">
          対象は「トラック」「アルバム」「アーティスト」のうちどれか1つだけ選んでください。
        </p>
        <form action={createRankingEntry} className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select name="ranking_id" required className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="" disabled>
                企画を選択
              </option>
              {rankingOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input name="rank" type="number" min="1" placeholder="順位" required className={`${inputClass} max-w-[100px]`} />
            <input name="period_date" type="date" required className={`${inputClass} max-w-[160px]`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select name="track_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(トラック指定なし)</option>
              {trackOptions.map((t) => {
                const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
                return (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {artist?.name ? ` — ${artist.name}` : ''}
                  </option>
                )
              })}
            </select>
            <select name="album_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(アルバム指定なし)</option>
              {albumOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <select name="artist_id" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="">(アーティスト指定なし)</option>
              {artistOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <input name="metric_value" type="number" step="any" placeholder="数値(任意。例: 再生回数)" className={`${inputClass} max-w-[200px]`} />
            <input name="metric_label" placeholder="単位・指標名(任意)" className={`${inputClass} max-w-[200px]`} />
          </div>
          <button type="submit" className={buttonClass}>
            ランクインを追加
          </button>
        </form>

        {rankingEntries && rankingEntries.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {rankingEntries.map((row) => {
              const ranking = Array.isArray(row.ranking) ? row.ranking[0] : row.ranking
              const track = Array.isArray(row.track) ? row.track[0] : row.track
              const album = Array.isArray(row.album) ? row.album[0] : row.album
              const artist = Array.isArray(row.artist) ? row.artist[0] : row.artist
              const target = track?.title ?? album?.title ?? artist?.name
              return (
                <li key={row.id}>
                  {ranking?.name} #{row.rank} — {target}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* タイアップ・シンクロアーカイブ */}
      <section className="mt-10 border-t border-white/10 pt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">タイアップ・シンクロアーカイブ</h2>
          <Link href="/media/sync" className="text-xs text-white/40 hover:text-white/70">
            公開ページを見る →
          </Link>
        </div>

        <form action={createSyncWork} className="mt-4 flex flex-wrap gap-2">
          <input name="title" placeholder="作品名(例: 熱闘甲子園)" required className={`${inputClass} max-w-xs`} />
          <select name="work_type" className={`${inputClass} max-w-[140px]`} defaultValue="">
            <option value="">起用種別(任意)</option>
            {WORK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input name="company_or_studio" placeholder="企業・制作会社(任意)" className={`${inputClass} max-w-xs`} />
          <input name="year" type="number" placeholder="年(任意)" className={`${inputClass} max-w-[120px]`} />
          <button type="submit" className={buttonClass}>
            作品を追加
          </button>
        </form>

        <form action={createSyncEntry} className="mt-4 flex flex-wrap items-center gap-2">
          <select name="sync_work_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              作品を選択
            </option>
            {syncWorkOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
                {w.year ? `(${w.year})` : ''}
              </option>
            ))}
          </select>
          <span className="text-xs text-white/40">で</span>
          <select name="track_id" required className={`${inputClass} max-w-xs`} defaultValue="">
            <option value="" disabled>
              トラックを選択
            </option>
            {trackOptions.map((t) => {
              const artist = Array.isArray(t.artist) ? t.artist[0] : t.artist
              return (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {artist?.name ? ` — ${artist.name}` : ''}
                </option>
              )
            })}
          </select>
          <span className="text-xs text-white/40">を使用</span>
          <input name="usage_detail" placeholder="使用箇所(任意。例: OPテーマ)" className={`${inputClass} max-w-xs`} />
          <button type="submit" className={buttonClass}>
            起用楽曲を追加
          </button>
        </form>

        {syncEntries && syncEntries.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-white/60">
            {syncEntries.map((row) => {
              const work = Array.isArray(row.sync_work) ? row.sync_work[0] : row.sync_work
              const track = Array.isArray(row.track) ? row.track[0] : row.track
              return (
                <li key={row.id}>
                  {work?.title} — {track?.title}
                  {row.usage_detail ? `(${row.usage_detail})` : ''}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
