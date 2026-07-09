// Pure matching helpers for registration-document scanning.
// No database, no network — the matching rules must be testable in isolation.

// Đ (U+0110) and đ (U+0111) are distinct letters, not decomposable by NFD.
// Without this map, "Đurić" would never match "Duric".
const DJ_RE = /[ĐđÐ]/g;

export function normalizeName(raw: string): string {
  return raw
    .replace(DJ_RE, "D")
    .normalize("NFD")
    // \p{M} matches every combining mark, so "ć" (c + U+0301) collapses to "c".
    // Written as a property escape rather than a literal range, which would put
    // invisible combining characters into the source.
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// A real VIN never contains I, O or Q — the standard forbids them precisely
// because they are confusable with 1 and 0. Any such character is a misread.
export function canonicalVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OQ]/g, "0")
    .replace(/I/g, "1");
}

export function normalizePlates(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length]!;
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
