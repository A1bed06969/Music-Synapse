import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// サイト全体をBasic認証で保護する。管理画面(/admin以下)はデータを自由に
// 書き換えられる(ログイン機構が無い前提のため)、公開ページも含めて
// サイト全体を非公開にする。
export function proxy(request: NextRequest) {
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Basic ')) {
    const base64Credentials = authHeader.slice('Basic '.length)
    const [user, password] = Buffer.from(base64Credentials, 'base64').toString('utf-8').split(':')
    if (user === process.env.BASIC_AUTH_USER && password === process.env.BASIC_AUTH_PASSWORD) {
      return NextResponse.next()
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Music Synapse"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
