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
      .select('id, disc_guide_id')
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

    return NextResponse.json({ success: true, album_id: result.albumId });
  } catch (err) {
    console.error('Register-one endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
