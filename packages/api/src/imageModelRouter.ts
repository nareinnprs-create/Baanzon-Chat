/** Image-generation model routing for the Cloudflare Workers AI catalog
 *  deployed on this account (see api/server/routes/images-generate.js).
 *  Models are the approved launch set; the router picks per request so users
 *  never need to know or choose a model identity. Each pick carries an
 *  equally-powerful failover chain (pickImageChain) so a deprecated or
 *  saturated backing hops automatically. */

export const IMAGE_MODELS = {
  klein9: '@cf/black-forest-labs/flux-2-klein-9b',
  klein4: '@cf/black-forest-labs/flux-2-klein-4b',
  flux2dev: '@cf/black-forest-labs/flux-2-dev',
  schnell: '@cf/black-forest-labs/flux-1-schnell',
  lucid: '@cf/leonardo/lucid-origin',
  phoenix: '@cf/leonardo/phoenix-1.0',
  sdxl: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
  lightning: '@cf/bytedance/stable-diffusion-xl-lightning',
  dreamshaper: '@cf/lykon/dreamshaper-8-lcm',
  inpaint: '@cf/runwayml/stable-diffusion-v1-5-inpainting',
} as const;

/** Phrases a user may type to name a model themselves; the model id is never
 *  echoed back by us - matching only the words the user already used. */
const EXPLICIT: Array<[RegExp, keyof typeof IMAGE_MODELS]> = [
  [/dreamshaper/i, 'dreamshaper'],
  [/lucid/i, 'lucid'],
  [/phoenix/i, 'phoenix'],
  [/inpaint/i, 'inpaint'],
  [/klein/i, 'klein9'],
  [/sdxl/i, 'sdxl'],
  [/lightning/i, 'lightning'],
  [/flux[ -]?2[ -]?dev/i, 'flux2dev'],
  [/flux/i, 'klein9'],
  [/stable[ -]?diffusion/i, 'sdxl'],
];

/** Keyword lanes, first match wins. */
const LANES: Array<[RegExp, keyof typeof IMAGE_MODELS]> = [
  [/\b(fast|quick|quickly|rough|sketch|draft|drafts)\b/i, 'klein4'],
  [/\b(logo|poster|banner|lettering|typography)\b/i, 'phoenix'],
  [
    /\b(painting|artistic|watercolor|oil[ -]?paint|anime|illustration|fantasy|dreamlike|dreamscape|stylized)\b/i,
    'dreamshaper',
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
  klein4: ['lightning', 'klein9'],
  flux2dev: ['klein9', 'lucid'],
  schnell: ['klein4', 'lightning'],
  lucid: ['flux2dev', 'phoenix'],
  phoenix: ['lucid', 'klein9'],
  sdxl: ['lightning', 'dreamshaper'],
  lightning: ['klein4', 'sdxl'],
  dreamshaper: ['sdxl', 'klein9'],
  inpaint: [],
};

/** Picks the generation model for a prompt: an explicitly named model wins,
 *  then speed/typography/artistic/photoreal lanes, then the detailed default. */
export function pickImageModel(prompt: string): string {
  return pickImageChain(prompt)[0];
}

/** Picks the model AND its failover alternates as concrete ids: [primary,
 *  ...equally-powerful backups]. Callers try them in order; inpaint entries
 *  are skipped by callers that cannot supply an input image. */
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
