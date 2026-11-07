/**
 * Timestamp formatting helpers for the Canvas feature.
 */

export function formatTimestamp(value: string, locales?: Intl.LocalesArgument): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(locales);
}
