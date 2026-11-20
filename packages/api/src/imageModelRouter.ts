/** Image-generation model routing for the Cloudflare Workers AI catalog
 *  deployed on this account (see api/server/routes/images-generate.js).
 *  Every model here was live-probed (2026-11-20): the SDXL family,
 *  dreamshaper and the inpaint model are deprecated on this account and were
 *  removed. Each pick carries an equally-powerful failover chain
 *  (pickImageChain) so a retired backing hops automatically. */

export const IMAGE_MODELS = {
  klein9: '@cf/black-forest-labs/flux-2-klein-9b',
  klein4: '@cf/black-forest-labs/flux-2-klein-4b',
  flux2dev: '@cf/black-forest-labs/flux-2-dev',
  schnell: '@cf/black-forest-labs/flux-1-schnell',
  lucid: '@cf/leonardo/lucid-origin',
  phoenix: '@cf/leonardo/phoenix-1.0',
} as const;

/** Phrases a user may type to name a model themselves; the model id is never
 *  echoed back by us - matching only the words the user already used. */
const EXPLICIT: Array<[RegExp, keyof typeof IMAGE_MODELS]> = [
  [/lucid/i, 'lucid'],
  [/phoenix/i, 'phoenix'],
  [/dreamshaper|inpaint/i, 'klein4'], // retired names map to the edit-capable model
  [/klein/i, 'klein9'],
  [/sdxl|lightning/i, 'klein4'], // retired speed models map to the fast flux
  [/flux[ -]?2[ -]?dev/i, 'flux2dev'],
  [/flux/i, 'klein9'],
  [/stable[ -]?diffusion/i, 'klein9'],
];

/** Keyword lanes, first match wins. */
const LANES: Array<[RegExp, keyof typeof IMAGE_MODELS]> = [
  [/\b(fast|quick|quickly|rough|sketch|draft|drafts)\b/i, 'klein4'],
  [/\b(logo|poster|banner|lettering|typography)\b/i, 'phoenix'],
  [
    /\b(painting|artistic|watercolor|oil[ -]?paint|anime|illustration|fantasy|dreamlike|dreamscape|stylized)\b/i,
    'phoenix',
  ],
  [
    /\b(photo|photograph|photoreal|photorealistic|realistic|portrait|landscape|cinematic|headshot)\b/i,
    'lucid',
  ],
];

/** Equally-powerful alternates per lane key: the first entry is the pick, the
 *  rest are the automatic failover order. */
const IMAGE_FAILOVER: Record<keyof typeof IMAGE_MODELS, Array<keyof typeof IMAGE_MODELS>> = {
  klein9: ['flux2dev', 'lucid', 'phoenix'],
  klein4: ['schnell', 'klein9'],
  flux2dev: ['klein9', 'lucid'],
  schnell: ['klein4', 'klein9'],
  lucid: ['flux2dev', 'phoenix'],
  phoenix: ['lucid', 'klein9'],
};

/** Picks the generation model for a prompt: an explicitly named model wins,
 *  then speed/typography/artistic/photoreal lanes, then the detailed default. */
export function pickImageModel(prompt: string): string {
  return pickImageChain(prompt)[0];
}

/** Picks the model AND its failover alternates as concrete ids: [primary,
 *  ...equally-powerful backups]. Callers try them in order. */
export function pickImageChain(prompt: string): string[] {
  let key: keyof typeof IMAGE_MODELS = 'klein9';
  for (const [re, candidate] of EXPLICIT) {
    if (re.test(prompt)) {
      key = candidate;
      break;
    }
  }
  if (key === 'klein9') {
    for (const [re, candidate] of LANES) {
      if (re.test(prompt)) {
        key = candidate;
        break;
      }
    }
  }
  const chain = [key, ...(IMAGE_FAILOVER[key] ?? [])].filter(
    (k, index, all) => all.indexOf(k) === index,
  );
  return chain.map((k) => IMAGE_MODELS[k]);
}
