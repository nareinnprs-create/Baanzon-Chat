/**
 * Full-page redirect seam.
 *
 * Kept separate from `./redirect` (auth redirect helpers) so a test can assert a
 * checkout destination without jsdom navigating: its `location.assign` is
 * read-only and throws "Not implemented: navigation".
 */
export function redirectTo(url: string): void {
  window.location.assign(url);
}

export default redirectTo;
