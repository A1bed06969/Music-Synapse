// ②の一括Geminiマッチングで、アーティストは紐付いたがアルバム/トラック同期が
// 完了しなかった分(afterOrNow()のフォールバックがawaitされずスクリプト終了時に
// 打ち切られていた事故、2026-09-19)の再同期用、一回限りの使い捨てスクリプト。
//
// dispatchAlbumSyncは/api/admin/album-syncへの実HTTPリクエストで、実処理は
// そのルート内のafter()で行われる(=呼び出し元のスクリプトの生存に依存しない、
// devサーバー自体のプロセスで動く)。ここでは「ジョブが受理されたこと」を確認する
// だけでなく、DBのalbum件数が実際に増えるまで一定時間ポーリングしてから次の
// アーティストに進む(同時に大量のアーティストのafter()がiTunesを叩き合って
// レート制限を悪化させるのを避けるため、実質的に直列化する)。
import { createAdminClient } from '@/utils/Supabase/admin'
import { fetchArtistWithAlbums } from '@/utils/itunes'
import { dispatchAlbumSync } from '@/utils/albumSyncDispatch'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const supabase = createAdminClient()

  const { data: artists } = await supabase
    .from('artist')
    .select('id, name, apple_music_artist_id, apple_music_country')
    .not('apple_music_artist_id', 'is', null)

  const targets: { id: string; name: string; appleMusicArtistId: string; country: string }[] = []
  for (const a of artists ?? []) {
    const { count } = await supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', a.id)
    if (!count) {
      targets.push({
        id: a.id,
        name: a.name,
        appleMusicArtistId: a.apple_music_artist_id as string,
        country: (a.apple_music_country as string) ?? 'JP',
      })
    }
  }

  console.log(`対象(アルバム0件のアーティスト): ${targets.length}件`)

  let synced = 0
  let timedOut = 0
  let failed = 0
  let noAlbumsOnItunes = 0

  for (const [i, artist] of targets.entries()) {
    if (i > 0) await sleep(10_000) // iTunesへの負荷を抑えるため、アーティスト間に間隔を空ける
    process.stdout.write(`[${i + 1}/${targets.length}] ${artist.name} ... `)
    try {
      const { albums } = await fetchArtistWithAlbums(artist.appleMusicArtistId, artist.country)
      if (albums.length === 0) {
        console.log('Apple Music側にアルバム無し')
        noAlbumsOnItunes++
        continue
      }

      await dispatchAlbumSync(artist.id, artist.name, artist.appleMusicArtistId, albums, 0, artist.country)

      // devサーバーのafter()側で実際に同期されるまでポーリングで待つ
      // (最大90秒、2秒間隔)。大きいカタログ(三浦大知111枚等)はチャンク分割
      // されるためこれでも終わらない場合があるが、その場合は次回このスクリプトを
      // 再実行すれば続きから拾われる(album件数>0になった時点で対象から外れるため、
      // 1枚でも同期できていれば十分。完全化したい場合は個別に確認する)。
      let done = false
      for (let wait = 0; wait < 90_000; wait += 2_000) {
        await sleep(2_000)
        const { count } = await supabase.from('album').select('id', { count: 'exact', head: true }).eq('artist_id', artist.id)
        if (count && count > 0) {
          done = true
          console.log(`✅ ${count}枚同期確認`)
          synced++
          break
        }
      }
      if (!done) {
        console.log('⏱️ 90秒待っても未反映(タイムアウト、次回再実行で拾う)')
        timedOut++
      }
    } catch (err) {
      console.log(`❌ ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n完了: 同期確認${synced}件、タイムアウト${timedOut}件、Apple Music側に無し${noAlbumsOnItunes}件、失敗${failed}件`)
}

main()
