// app/api/admin/disc-guide-scan/register/route.ts
//
// 確認画面の「確認して登録」(このページの全件をまとめて登録)。1件ずつ登録する
// 場合は/api/admin/disc-guide-scan/register-oneを使う。

import { createAdminClient } from '@/utils/Supabase/admin';
import { dispatchMusicBrainzImport } from '@/utils/musicbrainzImportDispatch';
import { registerOneConfirmedAlbum, type ConfirmedAlbum } from '@/utils/discGuideRegister';
import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// 1ページのエントリ(1枚あたりiTunes検索+登録)を順番に処理するうえ、after()内で
// 新規アーティストごとにMusicBrainzプロフィール取込も行うため、エントリ数が多い
// ページはmaxDuration(60秒)を超えてVercelの504で強制終了することが本番で
// 実際に発生した(1エントリの実登録に数秒〜十数秒かかりうるため、8件でも
// 余裕で60秒を超えうる)。レスポンスはすぐ返し、実処理はafter()に切り離す。
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

    after(() => registerAllConfirmedAlbums(supabase, pending));

    return NextResponse.json({ dispatched: true });
  } catch (err) {
    console.error('Register endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function registerAllConfirmedAlbums(
  supabase: ReturnType<typeof createAdminClient>,
  pending: { id: string; disc_guide_id: string; confirmed_data: { albums: ConfirmedAlbum[] } }
): Promise<void> {
  try {
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

    // すでにafter()の中なので、直接awaitしてよい(呼び出し元をさらにネストする必要は無い)
    for (const artistId of bulkImportArtistIds) {
      await dispatchMusicBrainzImport(artistId);
    }

    revalidatePath('/admin/data/discguides');
    revalidatePath('/admin/data/discguides/confirm');
    console.log(`ディスクガイド登録完了(pending_id=${pending.id}): ${registeredCount}件`);
  } catch (err) {
    console.error(`ディスクガイド登録に失敗しました(pending_id=${pending.id}):`, err);
  }
}
