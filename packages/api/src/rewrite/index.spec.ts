import {
  REWRITE_MAX_INSTRUCTION_LENGTH,
  REWRITE_MAX_TEXT_LENGTH,
  buildRewriteInstruction,
  isRewriteMode,
  validateRewriteInput,
} from './index';

describe('isRewriteMode', () => {
  it('accepts only the whitelisted modes', () => {
    expect(isRewriteMode('prompt')).toBe(true);
    expect(isRewriteMode('recap')).toBe(true);
    expect(isRewriteMode('rewrite')).toBe(false);
    expect(isRewriteMode(undefined)).toBe(false);
    expect(isRewriteMode('')).toBe(false);
  });
});

describe('buildRewriteInstruction', () => {
  it('keeps prompt and recap instructions distinct', () => {
    const prompt = buildRewriteInstruction('prompt');
    const recap = buildRewriteInstruction('recap');
    expect(prompt).toContain('prompt');
    expect(prompt).not.toContain('TL;DR');
    expect(recap).toContain('TL;DR');
    expect(recap).toContain('action items');
  });

  it('appends a non-empty user instruction', () => {
    const result = buildRewriteInstruction('prompt', ' make it terse ');
    expect(result).toContain('make it terse');
    expect(result).toContain('Additional instruction');
  });

  it('ignores blank instructions', () => {
    expect(buildRewriteInstruction('prompt', '   ')).toBe(buildRewriteInstruction('prompt'));
    expect(buildRewriteInstruction('recap', undefined)).toBe(buildRewriteInstruction('recap'));
  });
});

describe('validateRewriteInput', () => {
  it('accepts a minimal prompt request', () => {
    const result = validateRewriteInput({ text: 'make this better', mode: 'prompt' });
    expect(result).toEqual({
      ok: true,
      value: { text: 'make this better', mode: 'prompt' },
    });
  });

  it('accepts a recap request with endpoint, model, and instruction', () => {
    const result = validateRewriteInput({
      text: 'transcript',
      mode: 'recap',
      instruction: 'focus on decisions',
      endpoint: ' openAI ',
      model: 'gpt-4o',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        text: 'transcript',
        mode: 'recap',
        instruction: 'focus on decisions',
        endpoint: 'openAI',
        model: 'gpt-4o',
      },
    });
  });

  it('rejects a non-object body', () => {
    expect(validateRewriteInput(null).ok).toBe(false);
    expect(validateRewriteInput('text').ok).toBe(false);
    expect(validateRewriteInput(undefined).ok).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(validateRewriteInput({ text: 'x', mode: 'summarize' }).ok).toBe(false);
    expect(validateRewriteInput({ text: 'x' }).ok).toBe(false);
  });

  it('rejects empty, non-string, and oversized text', () => {
    expect(validateRewriteInput({ text: '', mode: 'prompt' }).ok).toBe(false);
    expect(validateRewriteInput({ text: '   ', mode: 'prompt' }).ok).toBe(false);
    expect(validateRewriteInput({ text: 5, mode: 'prompt' }).ok).toBe(false);
    expect(
      validateRewriteInput({ text: 'a'.repeat(REWRITE_MAX_TEXT_LENGTH + 1), mode: 'prompt' }).ok,
    ).toBe(false);
    expect(
      validateRewriteInput({ text: 'a'.repeat(REWRITE_MAX_TEXT_LENGTH), mode: 'prompt' }).ok,
    ).toBe(true);
  });

  it('rejects an oversized instruction', () => {
    expect(
      validateRewriteInput({
        text: 'x',
        mode: 'prompt',
        instruction: 'a'.repeat(REWRITE_MAX_INSTRUCTION_LENGTH + 1),
      }).ok,
    ).toBe(false);
  });

  it('strips control characters and caps endpoint/model identifiers', () => {
    const result = validateRewriteInput({
      text: 'x',
      mode: 'recap',
      endpoint: 'bad\u0000name',
      model: 'm'.repeat(500),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpoint).toBe('badname');
      expect(result.value.model).toHaveLength(200);
    }
  });

  it('drops empty endpoint/model after sanitizing', () => {
    const result = validateRewriteInput({ text: 'x', mode: 'recap', endpoint: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.endpoint).toBeUndefined();
    }
  });
});
