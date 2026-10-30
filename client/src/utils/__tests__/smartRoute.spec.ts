import { pickSmartModel } from '../smartRoute';

jest.mock('~/hooks', () => ({}));

const spec = (name: string, label = name, endpoint = 'openAI') => ({ name, label, endpoint });

describe('pickSmartModel', () => {
  it('returns null without specs or when nothing matches the tier', () => {
    expect(pickSmartModel('hi', [], 'openAI', 'gpt-4')).toBeNull();
    expect(pickSmartModel('hi', undefined, 'openAI', 'gpt-4')).toBeNull();
    // No fast-tier fragment in these deep models, and the prompt is fast-shaped.
    expect(
      pickSmartModel('hi', [spec('claude-opus'), spec('gpt-5-pro')], 'openAI', 'gpt-4'),
    ).toBeNull();
  });

  it('routes code/reasoning prompts to a deep model on the same endpoint', () => {
    const picked = pickSmartModel(
      'derive the closed form step by step',
      [spec('gpt-5-mini'), spec('gpt-5-pro'), spec('llama-3', 'llama-3', 'bedrock')],
      'openAI',
      'gpt-5-mini',
    );
    expect(picked).toBe('gpt-5-pro');
  });

  it('routes short plain prompts to a fast model', () => {
    const picked = pickSmartModel(
      'summarize this sentence',
      [spec('gpt-5'), spec('gpt-5-mini')],
      'openAI',
      'gpt-5',
    );
    expect(picked).toBe('gpt-5-mini');
  });

  it('returns null when the picked model equals the current one', () => {
    expect(
      pickSmartModel('summarize', [spec('gpt-5-mini')], 'openAI', 'gpt-5-mini'),
    ).toBeNull();
  });

  it('ignores specs from other endpoints', () => {
    const picked = pickSmartModel(
      'refactor this module',
      [spec('haiku-3', 'haiku-3', 'anthropic'), spec('gpt-5')],
      'openAI',
      'gpt-5',
    );
    // Only endpoint-matching specs are usable; no fast/deep fragment in gpt-5.
    expect(picked).toBeNull();
  });
});
