import { GALLERY_CATEGORIES, STARTER_TEMPLATES } from '../templates';

describe('starter templates data', () => {
  it('is a curated set with unique ids and complete, filled-in entries', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(STARTER_TEMPLATES.length).toBeLessThanOrEqual(12);

    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const template of STARTER_TEMPLATES) {
      expect(template.title.trim().length).toBeGreaterThan(0);
      expect(template.icon.trim().length).toBeGreaterThan(0);
      expect(template.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('filters cleanly by declared category, with every category covered', () => {
    for (const template of STARTER_TEMPLATES) {
      expect(GALLERY_CATEGORIES).toContain(template.category);
    }
    for (const category of GALLERY_CATEGORIES) {
      const inCategory = STARTER_TEMPLATES.filter((t) => t.category === category);
      expect(inCategory.length).toBeGreaterThan(0);
    }
  });

  it('stays model-agnostic (no vendor or model names in copy)', () => {
    const branded = /\bgpt\b|\bclaude\b|\bgemini\b|\bllama\b|\bmistral\b|openai|anthropic/i;
    for (const template of STARTER_TEMPLATES) {
      expect(`${template.title} ${template.prompt}`).not.toMatch(branded);
    }
  });
});
