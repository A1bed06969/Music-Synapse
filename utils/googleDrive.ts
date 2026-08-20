// Google Driveのフォルダから画像を読み取るためのユーティリティ(ディスクガイドの
// 読み取り用)。サービスアカウント認証を使う: Google Cloudでサービスアカウントを
// 作成し、そのメールアドレスに対象のDriveフォルダを閲覧者として共有してもらう
// だけで連携できる(OAuthのようなログイン・トークン更新の仕組みが不要)。
// 環境変数:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL: サービスアカウントのclient_email
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: サービスアカウントキーJSON内のprivate_key
//     (改行は環境変数上では\nとして保存し、読み込み時に実改行へ戻す)
import { google } from 'googleapis'

export type DriveImageFile = {
  id: string
  name: string
  mimeType: string
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY が設定されていません。')
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
}

/** 指定フォルダ直下の画像ファイル(image/*)一覧を取得する(サブフォルダは辿らない)。
 * ページングに対応し、1000件を超えるフォルダでも全件取得する */
export async function listImagesInFolder(folderId: string): Promise<DriveImageFile[]> {
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })

  const files: DriveImageFile[] = []
  let pageToken: string | undefined

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000,
      pageToken,
    })
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType) {
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType })
      }
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  // Drive APIの返す順序は不定なため、ファイル名で安定ソートする
  // (「少しずつ読み取る」運用で毎回同じ順番になるように)
  files.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  return files
}

/** 指定ファイルIDの中身をバイト列として取得する */
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const auth = getAuth()
  const drive = google.drive({ version: 'v3', auth })

  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  return Buffer.from(res.data as ArrayBuffer)
}
