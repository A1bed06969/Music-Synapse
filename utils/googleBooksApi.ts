// utils/googleBooksApi.ts

const GOOGLE_BOOKS_API_BASE = 'https://www.googleapis.com/books/v1/volumes';

export type GoogleBooksCoverResult =
  | { coverUrl: string; error?: undefined }
  // 'rate_limited': APIキー未設定または割当超過(429)。「表紙が無い」とは別の
  // 一時的な状態なので、呼び出し側で恒久的な"見つかりませんでした"扱いにしない。
  // 'not_found': 検索は成功したがこのISBNの表紙情報が無い。
  // 'network_error': タイムアウト・接続エラーなど。
  | { coverUrl: null; error: 'rate_limited' | 'not_found' | 'network_error' };

export async function fetchGoogleBooksCover(isbn: string): Promise<GoogleBooksCoverResult> {
  if (!isbn) return { coverUrl: null, error: 'not_found' };

  try {
    const params = new URLSearchParams({
      q: `isbn:${isbn}`,
      maxResults: '1',
    });
    // 未設定でも動作する(匿名の共有クォータにフォールバック)が、
    // GOOGLE_BOOKS_API_KEYがあれば専用クォータを使うため429を避けやすくなる。
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    if (apiKey) params.set('key', apiKey);

    const res = await fetch(`${GOOGLE_BOOKS_API_BASE}?${params}`, {
      headers: { 'User-Agent': 'MusicSynapse/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 429) {
      console.warn(`Google Books API rate limited (429) for ISBN ${isbn}`);
      return { coverUrl: null, error: 'rate_limited' };
    }

    if (!res.ok) {
      console.warn(`Google Books API error: ${res.status}`);
      return { coverUrl: null, error: 'network_error' };
    }

    const data = (await res.json()) as {
      items?: Array<{ volumeInfo?: { imageLinks?: { thumbnail?: string } } }>;
    };

    const coverUrl = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    if (!coverUrl) return { coverUrl: null, error: 'not_found' };
    return { coverUrl };
  } catch (err) {
    console.error(`Failed to fetch cover for ISBN ${isbn}:`, err);
    return { coverUrl: null, error: 'network_error' };
  }
}
