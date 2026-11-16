/** Image-generation model routing for the Cloudflare Workers AI catalog
 *  deployed on this account (see api/server/routes/images-generate.js).
 *  Models are the approved launch set; the router picks per request so users
 *  never need to know or choose a model identity. */

export const IMAGE_MODELS = {
  klein9: '@cf/black-forest-labs/flux-2-klein-9b',
  klein4: '@cf/black-forest-labs/flux-2-klein-4b',
  lucid: '@cf/leonardo/lucid-origin',
  phoenix: '@cf/leonardo/phoenix-1.0',
  sdxl: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
  lightning: '@cf/bytedance/stable-diffusion-xl-lightning',
  dreamshaper: '@cf/lykon/dreamshaper-8-lcm',
  inpaint: '@cf/runwayml/stable-diffusion-v1-5-inpainting',
} as const;

/** Phrases a user may type to name a model themselves; the model id is never
 *  echoed back by us — matching only the words the user already used. */
const EXPLICIT: Array<[RegExp, keyof typeof IMAGE_MODELS]> = [
  [/dreamshaper/i, 'dreamshaper'],
  [/lucid/i, 'lucid'],
  [/phoenix/i, 'phoenix'],
  [/inpaint/i, 'inpaint'],
  [/klein/i, 'klein9'],
  [/sdxl/i, 'sdxl'],
  [/lightning/i, 'lightning'],
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

/** Picks the generation model for a prompt: an explicitly named model wins,
 *  then speed/typography/artistic/photoreal lanes, then the detailed default. */
export function pickImageModel(prompt: string): string {
  for (const [re, key] of EXPLICIT) {
    if (re.test(prompt)) {
      return IMAGE_MODELS[key];
    }
  }
  for (const [re, key] of LANES) {
    if (re.test(prompt)) {
      return IMAGE_MODELS[key];
    }
  }
  return IMAGE_MODELS.klein9;
}
