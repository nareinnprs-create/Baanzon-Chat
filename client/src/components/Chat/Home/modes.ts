import type { TPreset, TStartupConfig } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { getModelSpecPreset } from '~/utils';

/**
 * A starting mode offered on the Home onboarding surface.
 *
 * Each mode is resolved to a model spec, *not* to a fabricated backend feature.
 * Specs are deployment-defined (`modelSpecs.list` in `baanzon.yaml`), so a mode
 * only carries the spec names it prefers; when none is configured the chip falls
 * back to the app's default endpoint (see `HomeOnboarding`). This keeps the
 * mapping honest for forks that have not authored a mode-specific spec.
 */
export type HomeMode = {
  id: string;
  /** Localized chip label. */
  labelKey: TranslationKeys;
  /**
   * Preferred model spec names, matched case-insensitively against
   * `startupConfig.modelSpecs.list`. The first match wins, letting a deployment
   * offer e.g. `deep-research` or an agent-backed `research` spec without a code
   * change. An empty list means "the default endpoint only".
   */
  specNames: string[];
};

export const HOME_MODES: HomeMode[] = [
  {
    id: 'chat',
    labelKey: 'com_ui_home_mode_chat',
    // The default conversation; no spec override so the app's normal default applies.
    specNames: [],
  },
  {
    id: 'deepResearch',
    labelKey: 'com_ui_home_mode_deep_research',
    // Deep research is a deployment concern (a spec that enables web search or an
    // agent). Prefer one by name; otherwise fall back to the default endpoint.
    specNames: ['deep-research', 'deep_research', 'research'],
  },
  {
    id: 'dataAnalysis',
    labelKey: 'com_ui_home_mode_data_analysis',
    // Data analysis is likewise a spec (e.g. code-interpreter / file tools).
    specNames: ['data-analysis', 'data_analysis', 'analysis'],
  },
  {
    id: 'image',
    labelKey: 'com_ui_home_mode_image',
    // Image generation has no dedicated endpoint in this app; a spec is the only
    // real target. Prefer an image spec, otherwise the default endpoint.
    specNames: ['image', 'image-gen', 'image-generation', 'image_generation'],
  },
];

/**
 * Resolves a mode to a model spec preset, or `undefined` to let the caller fall
 * back to the default endpoint. Pure, so it can be unit tested without React.
 */
export function resolveModePreset(
  mode: HomeMode,
  startupConfig?: TStartupConfig,
): Partial<TPreset> | undefined {
  const list = startupConfig?.modelSpecs?.list;
  if (!list?.length || mode.specNames.length === 0) {
    return undefined;
  }

  const lowercased = mode.specNames.map((name) => name.toLowerCase());
  const spec = list.find((candidate) => lowercased.includes(candidate.name.toLowerCase()));
  if (!spec) {
    return undefined;
  }

  const preset = getModelSpecPreset(spec);
  return preset ? (preset as Partial<TPreset>) : undefined;
}
