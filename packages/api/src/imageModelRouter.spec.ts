import { IMAGE_MODELS, pickImageModel } from './imageModelRouter';

describe('pickImageModel', () => {
  it('defaults to the detailed flagship model', () => {
    expect(pickImageModel('a quiet village at dawn')).toBe(IMAGE_MODELS.klein9);
    expect(pickImageModel('')).toBe(IMAGE_MODELS.klein9);
  });

  it('honors a model named by the user before any lane', () => {
    expect(pickImageModel('dreamshaper style, a fox in a forest')).toBe(IMAGE_MODELS.dreamshaper);
    expect(pickImageModel('use phoenix for this')).toBe(IMAGE_MODELS.phoenix);
    expect(pickImageModel('an ink drawing, lucid origin please')).toBe(IMAGE_MODELS.lucid);
    expect(pickImageModel('make it with inpainting')).toBe(IMAGE_MODELS.inpaint);
    expect(pickImageModel('flux, a red car')).toBe(IMAGE_MODELS.klein9);
  });

  it('routes explicit speed wording to the smallest model', () => {
    expect(pickImageModel('a quick sketch of a dog')).toBe(IMAGE_MODELS.klein4);
    expect(pickImageModel('rough draft of a webpage layout')).toBe(IMAGE_MODELS.klein4);
  });

  it('routes typography requests to the typography model', () => {
    expect(pickImageModel('a logo for a coffee shop')).toBe(IMAGE_MODELS.phoenix);
    expect(pickImageModel('poster with the words open now')).toBe(IMAGE_MODELS.phoenix);
  });

  it('routes artistic wording to the painterly model', () => {
    expect(pickImageModel('watercolor painting of mountains')).toBe(IMAGE_MODELS.dreamshaper);
    expect(pickImageModel('anime illustration of a hero')).toBe(IMAGE_MODELS.dreamshaper);
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
});
