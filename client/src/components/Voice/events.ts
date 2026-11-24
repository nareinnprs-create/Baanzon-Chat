/**
 * One page-level signal: the Diya session is taking the microphone.
 *
 * Dictation and Diya must never capture at the same time; the header button
 * announces the handover and the composer mic drops its take instead of
 * competing for the device.
 */
export const DIYA_OPEN_EVENT = 'baanzon:diya-open';

export function announceDiyaOpen(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DIYA_OPEN_EVENT));
  }
}
