// utils/googleBooksApi.ts

const GOOGLE_BOOKS_API_BASE = 'https://www.googleapis.com/books/v1/volumes';

export async function fetchGoogleBooksCover(isbn: string): Promise<string | null> {
  if (!isbn) return null;

  try {
    const params = new URLSearchParams({
      q: `isbn:${isbn}`,
      maxResults: '1',
    });

    const res = await fetch(`${GOOGLE_BOOKS_API_BASE}?${params}`, {
      headers: { 'User-Agent': 'MusicSynapse/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`Google Books API error: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      items?: Array<{ volumeInfo?: { imageLinks?: { thumbnail?: string } } }>;
    };

    const coverUrl = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    return coverUrl || null;
  } catch (err) {
    console.error(`Failed to fetch cover for ISBN ${isbn}:`, err);
    return null;
  }
}
