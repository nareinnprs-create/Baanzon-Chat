import type { TModelSpec } from 'librechat-data-provider';

/** The slice of a model spec the heuristic needs — keeps callers and tests
 *  independent of the full TModelSpec shape. */
export type SmartRouteSpec = Pick<TModelSpec, 'name' | 'label'> & { endpoint?: string };

/** Deep-work signals: code blocks, long prompts, and reasoning verbs. */
const DEEP_PATTERN =
  /```|\b(derive|prove|optimize|refactor|architect|algorithm|debug|analyz|step[- ]by[- ]step|explain why|math|proof)\b/i;

/** Fast-tier name fragments, in rough market naming (mini/flash/haiku/small). */
const FAST_PATTERN = /mini|flash|haiku|small|fast|lite|turbo/i;
const DEEP_MODEL_PATTERN = /opus|pro|o[134](-|$)|deep|r1|thinking|reasoning|large|max/i;

/**
 * X5 Smart Route v1 heuristic: classifies a prompt fast/deep and picks the
 * best matching model from the user's available specs for the conversation's
 * endpoint. Pure and sync — runs on the submit path. Returns null when it
 * cannot improve on the current model (no specs, or no tier match), in which
 * case the caller keeps the user's selection.
 */
export function pickSmartModel(
  text: string,
  specs: SmartRouteSpec[] | undefined,
  endpoint: string | null | undefined,
  currentModel: string | null | undefined,
): string | null {
  if (!specs?.length) {
    return null;
  }
  const usable = specs.filter((spec) => endpoint == null || spec.endpoint === endpoint);
  if (usable.length === 0) {
    return null;
  }
  const wantsDeep = text.length > 600 || DEEP_PATTERN.test(text);
  const tier = wantsDeep ? DEEP_MODEL_PATTERN : FAST_PATTERN;
  const matches = usable.filter((spec) => tier.test(spec.name ?? '') || tier.test(spec.label ?? ''));
  if (matches.length === 0) {
    return null;
  }
  const picked = matches[0].name ?? matches[0].label ?? null;
  return picked != null && picked !== currentModel ? picked : null;
}
