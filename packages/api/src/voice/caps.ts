import type { VoiceTier } from './types';

/**
 * Daily voice minutes per tier. Voice bills wall-clock session time and costs
 * more per minute than images, so caps are ~2x the image caps at every tier.
 */
export const VOICE_TIER_MINUTES: Record<VoiceTier, number> = {
  free: 10,
  lite: 30,
  pro: 120,
  enterprise: 400,
};

/** Day boundary for usage caps: midnight IST (matches chat + image caps). */
export const voiceDayKey = (d: Date = new Date()): string =>
  d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function normalizeTier(tier?: string | null): VoiceTier {
  const t = String(tier || 'free').toLowerCase();
  return t === 'lite' || t === 'pro' || t === 'enterprise' ? t : 'free';
}

/** Seconds the user may still use today given seconds already consumed. */
export function remainingSeconds(
  tier: VoiceTier,
  usedSeconds: number,
  tierMinutes?: Partial<Record<VoiceTier, number>>,
): number {
  const capMinutes = tierMinutes?.[tier] ?? VOICE_TIER_MINUTES[tier];
  return Math.max(0, capMinutes * 60 - usedSeconds);
}
