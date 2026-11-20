import { IMAGE_MODELS, pickImageChain, pickImageModel } from './imageModelRouter';

describe('pickImageModel', () => {
  it('defaults to the detailed flagship model', () => {
    expect(pickImageModel('a quiet village at dawn')).toBe(IMAGE_MODELS.klein9);
    expect(pickImageModel('')).toBe(IMAGE_MODELS.klein9);
  });

  it('honors a model named by the user before any lane', () => {
    expect(pickImageModel('use phoenix for this')).toBe(IMAGE_MODELS.phoenix);
    expect(pickImageModel('an ink drawing, lucid origin please')).toBe(IMAGE_MODELS.lucid);
    expect(pickImageModel('flux, a red car')).toBe(IMAGE_MODELS.klein9);
    expect(pickImageModel('flux 2 dev, ultra realistic')).toBe(IMAGE_MODELS.flux2dev);
  });

  it('maps retired model names to the live replacements', () => {
    // dreamshaper / inpaint retired -> edit-capable klein-4
    expect(pickImageModel('dreamshaper style, a fox in a forest')).toBe(IMAGE_MODELS.klein4);
    expect(pickImageModel('make it with inpainting')).toBe(IMAGE_MODELS.klein4);
    // sdxl / lightning retired -> fast flux
    expect(pickImageModel('sdxl, a castle')).toBe(IMAGE_MODELS.klein4);
  });

  it('routes explicit speed wording to the smallest model', () => {
    expect(pickImageModel('a quick sketch of a dog')).toBe(IMAGE_MODELS.klein4);
    expect(pickImageModel('rough draft of a webpage layout')).toBe(IMAGE_MODELS.klein4);
  });

  it('routes typography requests to the typography model', () => {
    expect(pickImageModel('a logo for a coffee shop')).toBe(IMAGE_MODELS.phoenix);
    expect(pickImageModel('poster with the words open now')).toBe(IMAGE_MODELS.phoenix);
  });

  it('routes artistic wording to the prompt-adherent art model', () => {
    expect(pickImageModel('watercolor painting of mountains')).toBe(IMAGE_MODELS.phoenix);
    expect(pickImageModel('anime illustration of a hero')).toBe(IMAGE_MODELS.phoenix);
  });

  it('routes photographic wording to the photographic model', () => {
    expect(pickImageModel('photorealistic portrait of a woman')).toBe(IMAGE_MODELS.lucid);
    expect(pickImageModel('cinematic landscape at sunset')).toBe(IMAGE_MODELS.lucid);
  });

  it('prefers explicit speed wording over later lanes', () => {
    expect(pickImageModel('fast watercolor of a lake')).toBe(IMAGE_MODELS.klein4);
  });

  it('every catalog entry is an @cf id', () => {
    for (const id of Object.values(IMAGE_MODELS)) {
      expect(id).toMatch(/^@cf\//);
    }
  });

  it('never ships a deprecated model id', () => {
    const deprecated = [
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      '@cf/bytedance/stable-diffusion-xl-lightning',
      '@cf/lykon/dreamshaper-8-lcm',
      '@cf/runwayml/stable-diffusion-v1-5-inpainting',
    ];
    for (const id of Object.values(IMAGE_MODELS)) {
      expect(deprecated).not.toContain(id);
    }
  });
});

describe('pickImageChain', () => {
  it('returns the pick followed by live alternates only', () => {
    const chain = pickImageChain('a quiet village at dawn');
    expect(chain[0]).toBe(IMAGE_MODELS.klein9);
    expect(chain.length).toBeGreaterThanOrEqual(2);
    for (const id of chain) {
      expect(id).toMatch(/^@cf\//);
    }
  });

  it('keeps every chain member distinct', () => {
    for (const prompt of ['a logo', 'photoreal portrait', 'quick sketch', 'flux 2 dev art']) {
      const chain = pickImageChain(prompt);
      expect(new Set(chain).size).toBe(chain.length);
    }
  });
});
