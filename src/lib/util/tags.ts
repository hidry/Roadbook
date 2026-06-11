/**
 * Tag helpers — PURE (no React Native imports), Jest-tested.
 *
 * Tags are free-form strings on a trip (incl. the vehicle, e.g. "Dethleffs");
 * grouping/filtering of trips runs via tags, not via a parent container
 * (PROGRESS "Begriffe & Datenmodell", modeled after Furkot).
 */

/**
 * Parses comma-separated user input into a clean tag list: trimmed, empties
 * dropped, de-duplicated case-insensitively (first spelling wins).
 */
export function parseTagInput(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(',')) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Inverse of parseTagInput, for pre-filling the input field. */
export function formatTags(tags: string[]): string {
  return tags.join(', ');
}

/** All distinct tags across trips, case-insensitively unique, sorted A-Z. */
export function collectTags(taggedItems: { tags: string[] }[]): string[] {
  const seen = new Map<string, string>();
  for (const item of taggedItems) {
    for (const tag of item.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Case-insensitive tag filter; a null/empty filter matches everything. */
export function hasTag(item: { tags: string[] }, tag: string | null): boolean {
  if (!tag) return true;
  const key = tag.toLowerCase();
  return item.tags.some((t) => t.toLowerCase() === key);
}
