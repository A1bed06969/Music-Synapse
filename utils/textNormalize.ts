export function normalizeVenueName(value: string): string {
  return value.trim().normalize('NFKC')
}
