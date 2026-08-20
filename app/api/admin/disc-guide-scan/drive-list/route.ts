// app/api/admin/disc-guide-scan/drive-list/route.ts
//
// DiscGuideDriveImport.tsx(クライアントコンポーネント)から呼ばれる。Google Drive
// フォルダ内の画像一覧を返すだけの軽量エンドポイント。実際の取込ループは
// クライアント側から/api/admin/disc-guide-scan/drive-importを繰り返し叩く形にした
// (理由: サーバーが自分自身を再帰的に呼び出すchunk方式だと、間隔をどれだけ空けても
// Vercelのループ検知(HTTP 508、4回の自己呼び出しで必ず発火する固定閾値)に
// 引っかかることを本番の89枚一括取込で確認した)。
import { NextRequest, NextResponse } from 'next/server'
import { listImagesInFolder } from '@/utils/googleDrive'

function extractDriveFolderId(input: string): string {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]
  return trimmed
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { folderUrl } = body as { folderUrl?: string }

  if (!folderUrl) {
    return NextResponse.json({ error: 'folderUrl is required' }, { status: 400 })
  }

  const folderId = extractDriveFolderId(folderUrl)

  try {
    const files = await listImagesInFolder(folderId)
    if (files.length === 0) {
      return NextResponse.json(
        { error: '指定フォルダに画像が見つかりませんでした(共有設定もご確認ください)。' },
        { status: 400 }
      )
    }
    return NextResponse.json({ folderId, files })
  } catch (err) {
    return NextResponse.json(
      { error: `Driveフォルダの読み取りに失敗しました: ${(err as Error).message}` },
      { status: 400 }
    )
  }
}
