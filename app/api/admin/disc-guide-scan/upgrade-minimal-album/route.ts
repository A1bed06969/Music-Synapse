// app/api/admin/disc-guide-scan/upgrade-minimal-album/route.ts
//
// register-one route(disc_guide_scan_pendingの一括登録)がiTunesで一致しなかった
// 場合に作る「最小限登録」(streaming_status: 'unreleased'、ジャケット・トラック無し)の
// アルバムを、findAppleMusicAlbumMatch(接尾辞付き再発盤の救済ロジック込み)で
// 再照合し、見つかれば実カタログのアルバムに差し替える。
// app/api/admin/ranking/upgrade-minimal-album/route.tsのdisc_guide_selection版。
import { createAdminClient } from '@/utils/Supabase/admin';
import { findAppleMusicAlbumMatch } from '@/utils/discGuideImport';
import { registerAlbumFromSearch } from '@/app/admin/import/search/actions';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { discGuideSelectionId } = await req.json();
  if (!discGuideSelectionId) {
    return NextResponse.json({ success: false, message: 'discGuideSelectionIdが必要です。' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: selection } = await supabase
    .from('disc_guide_selection')
    .select('id, album_id, album:album_id(id, title, streaming_status, artist:artist_id(name))')
    .eq('id', discGuideSelectionId)
    .maybeSingle();
  if (!selection) {
    return NextResponse.json({ success: false, message: '対象のdisc_guide_selectionが見つかりませんでした。' });
  }
  const album = Array.isArray(selection.album) ? selection.album[0] : selection.album;
  if (!album || album.streaming_status !== 'unreleased') {
    return NextResponse.json({ success: true, upgraded: false, message: '最小限登録ではないためスキップしました。' });
  }
  const artist = Array.isArray(album.artist) ? album.artist[0] : album.artist;
  if (!artist) {
    return NextResponse.json({ success: false, message: 'アーティスト情報が取得できませんでした。' });
  }

  const matched = await findAppleMusicAlbumMatch(artist.name, album.title);
  if (!matched) {
    return NextResponse.json({ success: true, upgraded: false, message: '今回も一致しませんでした。' });
  }

  const registerResult = await registerAlbumFromSearch(matched.collectionId);
  if (!registerResult.success) {
    return NextResponse.json({ success: false, message: `iTunes経由の登録に失敗: ${registerResult.message}` });
  }

  const { data: newAlbum } = await supabase
    .from('album')
    .select('id, title')
    .eq('apple_music_album_id', String(matched.collectionId))
    .maybeSingle();
  if (!newAlbum) {
    return NextResponse.json({ success: false, message: '登録後のアルバムが見つかりませんでした。' });
  }

  const oldAlbumId = album.id;

  // (disc_guide_id, album_id)にユニーク制約があるため、差し替え先が既に
  // 同じディスクガイドの別ページから登録済みの場合はupdateが失敗しうる。
  // その場合は重複行として今の行を削除するだけでよい(実アルバム自体は既に登録済み)。
  const { error: updateError } = await supabase
    .from('disc_guide_selection')
    .update({ album_id: newAlbum.id })
    .eq('id', discGuideSelectionId);
  if (updateError) {
    if (updateError.code === '23505') {
      await supabase.from('disc_guide_selection').delete().eq('id', discGuideSelectionId);
    } else {
      return NextResponse.json({ success: false, message: `disc_guide_selectionの更新に失敗: ${updateError.message}` });
    }
  }

  // 差し替えで最小限アルバムを参照する行が無くなったら削除する
  const [{ count: selectionRefs }, { count: trackRefs }] = await Promise.all([
    supabase.from('disc_guide_selection').select('id', { count: 'exact', head: true }).eq('album_id', oldAlbumId),
    supabase.from('track').select('id', { count: 'exact', head: true }).eq('album_id', oldAlbumId),
  ]);
  if (!selectionRefs && !trackRefs) {
    await supabase.from('album').delete().eq('id', oldAlbumId);
  }

  return NextResponse.json({ success: true, upgraded: true, newAlbumTitle: newAlbum.title, newAlbumId: newAlbum.id });
}
