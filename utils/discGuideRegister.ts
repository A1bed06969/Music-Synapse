// utils/discGuideRegister.ts
//
// 確認画面(ConfirmationClient.tsx)で確定した1件のアルバムを実際にDBへ登録する
// 処理。一括登録(app/api/admin/disc-guide-scan/register/route.ts)と1件ずつ登録
// (app/api/admin/disc-guide-scan/register-one/route.ts)の両方から使う共通ロジック。
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyAlbumType } from './albumType';
import { findAppleMusicAlbumMatch } from './discGuideImport';
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions';

export type ConfirmedAlbum = {
  extracted_index: number;
  title: string;
  artist_name: string;
  label?: string;
  year?: number;
  album_id?: string;
  create_new_album?: boolean;
};

export type RegisterOneResult = {
  albumId?: string;
  newArtistId?: string;
  selectionRegistered: boolean;
};

export async function registerOneConfirmedAlbum(
  supabase: SupabaseClient,
  discGuideId: string,
  albumData: ConfirmedAlbum
): Promise<RegisterOneResult> {
  let albumId = albumData.album_id;
  let newArtistId: string | undefined;

  // 確認画面の手動検索(Apple Musicカタログ全体を検索)で選ばれた候補は、
  // 自前DBにまだ無いためalbum_idが`itunes:<collectionId>`の形で来る
  // (app/admin/data/discguides/confirm/actions.ts参照)。自動マッチ済みの
  // create_new_albumパスと同じ経路(iTunes検索登録)で実データを作る。
  if (albumId?.startsWith('itunes:')) {
    const collectionId = Number(albumId.slice('itunes:'.length));
    albumId = undefined;
    const result = await registerAlbumFromSearch(collectionId);
    if (result.success) {
      const { data: registeredAlbum } = await supabase
        .from('album')
        .select('id')
        .eq('apple_music_album_id', String(collectionId))
        .maybeSingle();
      albumId = registeredAlbum?.id;
    } else {
      console.error(`iTunes経由の登録に失敗しました(collectionId=${collectionId}): ${result.message}`);
    }
  } else if (!albumId && albumData.create_new_album) {
    // まずiTunesで実カタログを検索する。タイトル完全一致(正規化後)かつ
    // アーティスト名一致の候補が1件だけ見つかった場合、既存の検索登録
    // (app/admin/import/search)と同じ経路で登録する。これによりトラック・
    // ジャケット画像・新規アーティストなら全カタログ同期まで揃った状態になる
    // (裸のinsertだけでは名前しかない空のアルバム行になってしまうため)
    const matched = await findAppleMusicAlbumMatch(albumData.artist_name, albumData.title);
    if (matched) {
      const result = await registerAlbumFromSearch(matched.collectionId);
      if (result.success) {
        const { data: registeredAlbum } = await supabase
          .from('album')
          .select('id')
          .eq('apple_music_album_id', String(matched.collectionId))
          .maybeSingle();
        albumId = registeredAlbum?.id;
      } else {
        console.error(`iTunes経由の登録に失敗しました("${albumData.title}"): ${result.message}`);
      }
    }

    // iTunesに実カタログが見つからない場合のフォールバック:
    // 従来通りOCRの手がかり(タイトル・アーティスト名のテキストのみ)で
    // 最低限の行を作る(トラック・画像は無いまま、後で手動で肉付けする想定)
    if (!albumId) {
      let artistId = albumData.artist_name;

      // Check if artist exists. .single()は0件・2件以上の両方でエラーになり、
      // dataがnullのまま握りつぶされるため、既に候補が複数ある場合も
      // 「存在しない」扱いになって重複作成されてしまう。.limit(1).maybeSingle()
      // なら該当が2件以上あっても先頭1件を安全に拾える。
      const { data: existingArtist } = await supabase
        .from('artist')
        .select('id')
        .ilike('name', `%${albumData.artist_name}%`)
        .limit(1)
        .maybeSingle();

      if (!existingArtist) {
        const { data: newArtist, error: artistError } = await supabase
          .from('artist')
          .insert({ name: albumData.artist_name })
          .select('id')
          .single();

        if (artistError) {
          console.error(`Failed to create artist "${albumData.artist_name}":`, artistError.message);
        }

        artistId = newArtist?.id || '';
        if (artistId) {
          newArtistId = artistId;
        }
      } else {
        artistId = existingArtist.id;
      }

      if (artistId) {
        const { data: newAlbum, error: albumError } = await supabase
          .from('album')
          .insert({
            artist_id: artistId,
            title: albumData.title,
            release_date: albumData.year ? `${albumData.year}-01-01` : null,
            // この時点ではトラック数が不明なため、タイトルの手がかりのみで判定する
            album_type: classifyAlbumType(albumData.title, null),
          })
          .select('id')
          .single();

        if (albumError) {
          console.error(`Failed to create album "${albumData.title}":`, albumError.message);
        }

        albumId = newAlbum?.id;
      }
    }
  }

  if (!albumId) {
    return { albumId: undefined, newArtistId, selectionRegistered: false };
  }

  // Register to disc_guide_selection。upsert + onConflict ignoreDuplicatesで、
  // (disc_guide_id, album_id)が既に登録済みなら何もしない(再試行時の冪等性)。
  const { error: selectionError } = await supabase.from('disc_guide_selection').upsert(
    { disc_guide_id: discGuideId, album_id: albumId, note: null },
    { onConflict: 'disc_guide_id,album_id', ignoreDuplicates: true }
  );

  if (selectionError) {
    console.error(
      `Failed to register album "${albumData.title}" (${albumId}) to disc guide selection:`,
      selectionError.message
    );
    return { albumId, newArtistId, selectionRegistered: false };
  }

  return { albumId, newArtistId, selectionRegistered: true };
}
