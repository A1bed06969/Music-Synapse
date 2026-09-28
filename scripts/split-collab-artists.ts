// Apple Musicの連名クレジット文字列がそのままartist.nameに入ってしまっている
// 「合成名アーティスト」(例: "DOYOUNG, SEULGI, ... & TRI.BE")を、既存の
// splitCollabArtistName(utils/itunes.ts)で個別アーティストに分割するバックフィル
// スクリプト。app/admin/import/actions.tsのupsertArtistFromItunesに再発防止の
// ガード(resolveEffectiveArtistName)を追加済みだが、ガード導入前に取り込まれた
// 既存データや、ガードの閾値(4パート未満)に収まらない稀なケースの掃除用に残す。
//
// 方針:
//   1. name中の','が3個以上あるartistを対象候補にする(false positiveの除外リストあり)
//   2. splitCollabArtistNameで分割(括弧の深さを追跡するので "RSVP (Ray J, ...)" の
//      ような正しい単一名義は分割されない=候補から自然に除外される)
//   3. 先頭の名前を「主アーティスト」とする(既存のsyncOneAlbumのtrue owner方式を踏襲)
//      - 同名の既存アーティスト(このgarbage行以外)が1件だけ見つかればそちらを主に
//        採用し、mergeArtists()でgarbage行の全参照(album/track/外部リンク等)を
//        付け替えてgarbage行を削除する
//      - 見つからなければgarbage行自身を主アーティストとして名前だけ差し替える
//        (apple_music_artist_idは連名クレジット専用の合成IDなので、再同期で名前が
//        また連名に戻ってしまわないようnullにしておく)
//   4. 残りの名前は既存アーティストを名前一致で再利用、無ければ空スタブを新規作成し、
//      garbage行が持っていた全アルバムにalbum_artist(role='featured')として追加する
//
// 実行方法:
//   npx tsx --env-file=.env.local scripts/split-collab-artists.ts --dry-run   (確認のみ、書き込み無し)
//   npx tsx --env-file=.env.local scripts/split-collab-artists.ts              (実際に反映)
import { createAdminClient } from '@/utils/Supabase/admin'
import { splitCollabArtistName } from '@/utils/itunes'
import { mergeArtists } from '@/app/admin/data/artists/duplicate-review/actions'

const DRY_RUN = process.argv.includes('--dry-run')

// 手動確認済みのfalse positive(実在する単一の名義で、分割してはいけないもの)
const EXCLUDE_IDS = new Set(['MS_ART_37cwf5ab']) // "Crosby, Stills, Nash, and Young"

type ArtistRow = { id: string; name: string }

async function main() {
  const supabase = createAdminClient()

  const rows: ArtistRow[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase.from('artist').select('id, name').not('name', 'is', null).order('id').range(offset, offset + 999)
    const page = (data ?? []) as ArtistRow[]
    rows.push(...page)
    if (page.length < 1000) break
    offset += 1000
  }

  const targets = rows.filter((r) => !EXCLUDE_IDS.has(r.id) && (r.name.match(/,/g) || []).length >= 3)
  console.log(`対象候補: ${targets.length}件${DRY_RUN ? '(dry-run)' : ''}\n`)

  let splitCount = 0
  let skippedAmbiguous = 0
  let newArtistsCreated = 0
  let reusedExisting = 0

  for (const g of targets) {
    const names = splitCollabArtistName(g.name)
    if (names.length <= 1) continue // 括弧内クレジットのみ等、分割不要

    const [primaryName, ...otherNames] = names
    console.log(`--- ${g.id} | ${g.name.slice(0, 60)}${g.name.length > 60 ? '...' : ''}`)
    console.log(`  主: ${primaryName}`)
    console.log(`  他: ${otherNames.join(' / ')}`)

    // このgarbage行が(削除される前提で)所有しているアルバムを先に確定しておく
    const { data: garbageAlbums } = await supabase.from('album').select('id, title').eq('artist_id', g.id)
    const albumIds = (garbageAlbums ?? []).map((a) => a.id)

    // 1) 主アーティストの解決
    const { data: primaryCandidates } = await supabase.from('artist').select('id').eq('name', primaryName).neq('id', g.id).limit(2)

    let primaryArtistId: string
    if (primaryCandidates && primaryCandidates.length === 1) {
      primaryArtistId = primaryCandidates[0].id
      console.log(`  → 既存の「${primaryName}」(${primaryArtistId})に統合`)
      if (!DRY_RUN) {
        const result = await mergeArtists(primaryArtistId, [g.id])
        if (!result.success) {
          console.error(`  ✗ 統合失敗: ${result.message}`)
          continue
        }
      }
      reusedExisting++
    } else if (primaryCandidates && primaryCandidates.length >= 2) {
      console.log(`  ✗ 「${primaryName}」に一致する既存アーティストが複数件あり曖昧なためスキップ`)
      skippedAmbiguous++
      continue
    } else {
      primaryArtistId = g.id
      console.log(`  → このアーティスト自身を「${primaryName}」に名称修正`)
      if (!DRY_RUN) {
        const { error } = await supabase
          .from('artist')
          .update({ name: primaryName, apple_music_artist_id: null })
          .eq('id', g.id)
        if (error) {
          console.error(`  ✗ 名称修正失敗: ${error.message}`)
          continue
        }
      }
    }

    // 2) 残りの名前を個別アーティストとして解決し、album_artistへ追加
    for (const otherName of otherNames) {
      const { data: otherCandidates } = await supabase
        .from('artist')
        .select('id')
        .eq('name', otherName)
        .neq('id', g.id)
        .limit(1)

      let otherArtistId: string
      if (otherCandidates && otherCandidates.length > 0) {
        otherArtistId = otherCandidates[0].id
      } else {
        if (DRY_RUN) {
          console.log(`  (dry-run) 新規スタブ作成予定: ${otherName}`)
          newArtistsCreated++
          continue
        }
        const { data: inserted, error } = await supabase.from('artist').insert({ name: otherName }).select('id').single()
        if (error || !inserted) {
          console.error(`  ✗ 「${otherName}」の新規作成に失敗: ${error?.message}`)
          continue
        }
        otherArtistId = inserted.id
        newArtistsCreated++
      }

      if (DRY_RUN) continue

      for (const albumId of albumIds) {
        const { data: existingLink } = await supabase
          .from('album_artist')
          .select('id')
          .eq('album_id', albumId)
          .eq('artist_id', otherArtistId)
          .maybeSingle()
        if (existingLink) continue
        const { count: existingCount } = await supabase
          .from('album_artist')
          .select('id', { count: 'exact', head: true })
          .eq('album_id', albumId)
        const { error: linkError } = await supabase
          .from('album_artist')
          .insert({ album_id: albumId, artist_id: otherArtistId, role: 'featured', billing_order: (existingCount ?? 0) + 1 })
        if (linkError) {
          console.error(`  ✗ album_artist登録失敗(album=${albumId}, artist=${otherArtistId}): ${linkError.message}`)
        }
      }
    }

    splitCount++
  }

  console.log(`\n完了: 分割${splitCount}件・曖昧スキップ${skippedAmbiguous}件・既存流用${reusedExisting}件・新規作成${newArtistsCreated}件`)
}

main()
