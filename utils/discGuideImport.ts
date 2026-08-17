import Tesseract from 'tesseract.js';

export type AlbumExtract = {
  title: string;
  artist_name: string;
  label?: string;
  release_year?: number;
};

export async function performOCR(imageUrl: string): Promise<{
  text: string;
  confidence: number;
}> {
  try {
    const result = await Tesseract.recognize(imageUrl, 'jpn+eng', {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    const confidence = result.data.confidence / 100; // Tesseract returns 0-100
    return {
      text: result.data.text,
      confidence,
    };
  } catch (err) {
    console.error(`OCR failed for image ${imageUrl}:`, err);
    throw new Error(`OCR processing failed: ${(err as Error).message}`);
  }
}

export async function parseOCRToAlbums(text: string): Promise<AlbumExtract[]> {
  // Simple heuristic parser: split by newlines and detect patterns
  const lines = text.split('\n').filter((l) => l.trim());
  const albums: AlbumExtract[] = [];

  let current: Partial<AlbumExtract> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect year pattern (YYYY)
    const yearMatch = trimmed.match(/\((\d{4})\)/);
    if (yearMatch) {
      current.release_year = parseInt(yearMatch[1], 10);
    }

    // Detect artist pattern (usually before title, shorter line)
    if (trimmed.length < 50 && !current.artist_name && !current.title) {
      current.artist_name = trimmed;
    } else if (!current.title && current.artist_name && trimmed.length < 100) {
      current.title = trimmed;
    } else if (trimmed.length < 50) {
      current.label = trimmed;
    }

    // If we have title + artist, save as album
    if (current.title && current.artist_name) {
      albums.push({
        title: current.title,
        artist_name: current.artist_name,
        label: current.label,
        release_year: current.release_year,
      });
      current = {};
    }
  }

  return albums;
}
