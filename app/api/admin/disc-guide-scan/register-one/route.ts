// app/api/admin/disc-guide-scan/register-one/route.ts
//
// 確認画面から1件だけをその場で登録する。1件だけなのでmaxDurationに余裕があり、
// register/route.tsのようにafter()へ切り離さずそのまま同期的に処理して結果を返す。
import { createAdminClient } from '@/utils/Supabase/admin';
import { dispatchMusicBrainzImport } from '@/utils/musicbrainzImportDispatch';
import { registerOneConfirmedAlbum, type ConfirmedAlbum } from '@/utils/discGuideRegister';
import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { pending_id, album } = (await req.json()) as { pending_id?: string; album?: ConfirmedAlbum };

    if (!pending_id || !album) {
      return NextResponse.json({ error: 'pending_id and album are required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: pending } = await supabase
      .from('disc_guide_scan_pending')
      .select('id, disc_guide_id, extracted_data, registered_indices')
      .eq('id', pending_id)
      .single();

    if (!pending) {
      return NextResponse.json({ error: 'Pending record not found' }, { status: 404 });
    }

    const result = await registerOneConfirmedAlbum(supabase, pending.disc_guide_id, album);

    if (result.newArtistId) {
      const newArtistId = result.newArtistId;
      after(() => dispatchMusicBrainzImport(newArtistId));
    }

    if (!result.selectionRegistered) {
      return NextResponse.json(
        { error: `「${album.title}」の登録に失敗しました。` },
        { status: 500 }
      );
    }

    // このページの全件が(1件ずつ登録経由で)登録し終わったら、確認待ちページ
    // 一覧(status='pending'で絞り込み)から消えるようにstatusを進める。
    // 一括登録(register/route.ts)は自身でstatus='registered'にするため、
    // ここでは1件ずつ登録の経路だけを扱う。
    const totalCount = Array.isArray(pending.extracted_data) ? pending.extracted_data.length : 0;
    const registeredIndices = Array.from(
      new Set([...(pending.registered_indices ?? []), album.extracted_index])
    );
    const update: Record<string, unknown> = { registered_indices: registeredIndices };
    if (totalCount > 0 && registeredIndices.length >= totalCount) {
      update.status = 'registered';
    }
    await supabase.from('disc_guide_scan_pending').update(update).eq('id', pending.id);

    return NextResponse.json({ success: true, album_id: result.albumId });
  } catch (err) {
    console.error('Register-one endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
