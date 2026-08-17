// app/api/admin/disc-guide-scan/upload/route.ts

import { createAdminClient } from '@/utils/Supabase/admin';
import { after } from 'next/server';
import { performOCR, parseOCRToAlbums, matchAlbumsWithCandidates } from '@/utils/discGuideImport';
import { NextRequest, NextResponse } from 'next/server';

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
          const imageUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;

          // 2. Run Tesseract OCR
          const ocrResult = await performOCR(imageUrl);

          // 3. Parse OCR result to albums
          const extracted = await parseOCRToAlbums(ocrResult.text);

          // 4. Match albums
          const matched = await matchAlbumsWithCandidates(supabase, extracted);

          // 5. Save to pending table
          const { data: pending } = await supabase
            .from('disc_guide_scan_pending')
            .insert({
              disc_guide_id: discGuideId,
              image_filename: file.name,
              image_url: imageUrl,
              extracted_data: extracted,
              extraction_confidence: ocrResult.confidence,
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
