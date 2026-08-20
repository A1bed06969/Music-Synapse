// app/api/admin/disc-guide-scan/register/route.ts
//
// 確認画面の「確認して登録」(このページの全件をまとめて登録)。1件ずつ登録する
// 場合は/api/admin/disc-guide-scan/register-oneを使う。
//
// 以前この処理全体をafter()でラップして504対策にしていたが、その中から呼ばれる
// registerOneConfirmedAlbum → registerAlbumFromSearch(app/admin/import/search/
// actions.ts)は内部で独自にafter()を複数回呼んでMusicBrainz取込・版統合・
// 新規アーティストの全カタログ同期をディスパッチしている。after()の中からさらに
// after()を呼んでも効かない(実際に本番で確認: 一括登録経由で新規作成された
// アーティストは登録した1枚のアルバムのまま止まり、MusicBrainzプロフィールも
// 全カタログ同期も一切走らなかった)。正しさを優先し同期実行に戻す
// (件数が多いページで504のリスクが残る場合はregister-one/route.tsの
// 1件ずつ登録を使う)。
import { createAdminClient } from '@/utils/Supabase/admin';
import { dispatchMusicBrainzImport } from '@/utils/musicbrainzImportDispatch';
import { registerOneConfirmedAlbum } from '@/utils/discGuideRegister';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { pending_id } = await req.json();

    if (!pending_id) {
      return NextResponse.json({ error: 'Missing pending_id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('*')
      .eq('id', pending_id)
      .single();

    if (!pending || pending.status !== 'confirmed') {
      return NextResponse.json(
        { error: 'Pending record not confirmed' },
        { status: 400 }
      );
    }

    const bulkImportArtistIds: string[] = [];
    let registeredCount = 0;

    for (const albumData of pending.confirmed_data.albums) {
      const result = await registerOneConfirmedAlbum(supabase, pending.disc_guide_id, albumData);
      if (result.newArtistId) bulkImportArtistIds.push(result.newArtistId);
      if (result.selectionRegistered) registeredCount++;
    }

    await supabase
      .from('disc_guide_scan_pending')
      .update({ status: 'registered' })
      .eq('id', pending.id);

    // このバルク登録insert(裸のフォールバック)経由で作られた新規アーティストの
    // MusicBrainz取込は、この関数自身がafter()で包まれていないただの通常リクエスト
    // なので、ここでafter()を使って問題ない(上のregisterOneConfirmedAlbum内部の
    // dispatchとは別枠 — こちらはitunes未ヒットのバレ挿入フォールバック専用)。
    for (const artistId of bulkImportArtistIds) {
      dispatchMusicBrainzImport(artistId).catch((err) =>
        console.error(`MusicBrainz取込のディスパッチに失敗しました(${artistId}):`, err)
      );
    }

    revalidatePath('/admin/data/discguides');
    revalidatePath('/admin/data/discguides/confirm');

    return NextResponse.json({
      success: true,
      message: `Registered ${registeredCount} albums`,
      registered_count: registeredCount,
      new_artists: bulkImportArtistIds,
    });
  } catch (err) {
    console.error('Register endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
