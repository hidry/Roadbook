/**
 * Link-field helpers — PURE (no React Native imports), Jest-tested.
 *
 * Used by the trip's Strava link field (README §8.1 Tier 1: link only, no API):
 * users paste share links with or without scheme; we normalize to https and
 * reject anything that is not a plausible http(s) URL — the value ends up in
 * `Linking.openURL`.
 */

/**
 * Normalizes user input to an http(s) URL: trims, prepends `https://` when no
 * scheme is given, validates. Returns null for empty input or anything that is
 * not http(s) (e.g. `javascript:` or `file:` schemes, free text).
 */
export function normalizeHttpUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A bare scheme or a hostname without a dot ("strava", "https://x") is a typo,
  // not a shareable link.
  if (!url.hostname.includes('.')) return null;
  return url.toString();
}
