export function toErrorMessage(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message) {
    return caught.message;
  }
  if (typeof caught === 'string' && caught) {
    return caught;
  }
  return fallback;
}
