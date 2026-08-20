// app/api/admin/disc-guide-scan/upload/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { after } from 'next/server';
import { matchAlbumsWithCandidates } from '@/utils/discGuideImport';
import { extractAlbumsWithGemini } from '@/utils/geminiDiscGuideExtract';
import { NextRequest, NextResponse } from 'next/server';

// 複数画像のOCRをafter()内で順次処理するため、デフォルトの関数実行時間では
// 足りない可能性がある。他の管理画面バックグラウンド処理(app/admin/import等)
// と同じ規約に合わせる。
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const discGuideId = formData.get('disc_guide_id') as string;
    const files = formData.getAll('files') as File[];

    if (!discGuideId || files.length === 0) {
      return NextResponse.json(
        { error: 'Missing disc_guide_id or files' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const pendingIds: string[] = [];

    // Trigger background processing
    after(async () => {
      for (const file of files) {
        try {
          // 1. Upload image (for now, use a simple URL placeholder; real implementation uses Supabase Storage)
          const buffer = Buffer.from(await file.arrayBuffer());
          const imageUrl = `data:${file.type};base64,${buffer.toString('base64')}`;

          // 2. Gemini に画像を渡し、構造化データを直接抽出する
          const extracted = await extractAlbumsWithGemini(buffer, file.type);

          // 3. Match albums
          const matched = await matchAlbumsWithCandidates(supabase, extracted);

          // 4. Save to pending table
          const { data: pending } = await supabase
            .from('disc_guide_scan_pending')
            .insert({
              disc_guide_id: discGuideId,
              image_filename: file.name,
              image_url: imageUrl,
              extracted_data: extracted,
              extraction_confidence: null,
              matched_data: matched,
              status: 'pending',
            })
            .select('id')
            .single();

          if (pending) {
            pendingIds.push(pending.id);
            console.log(`OCR processed: ${file.name} → ${pending.id}`);
          }
        } catch (err) {
          console.error(`Failed to process ${file.name}:`, err);
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: `${files.length} images queued for processing`,
      pending_ids: pendingIds,
    });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
