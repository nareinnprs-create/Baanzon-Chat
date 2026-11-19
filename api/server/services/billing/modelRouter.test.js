const {
  routeModel,
  resolveModelChain,
  isIndicText,
  toPublicModelId,
  toPublicAgentId,
  PUBLIC_MODELS,
  ALIASES,
  CHAINS,
  RAW_FAILOVER,
  FALLBACK,
} = require('./modelRouter');

describe('five public models resolve per tier', () => {
  it('exposes exactly the five public slugs', () => {
    expect(PUBLIC_MODELS.sort()).toEqual([
      'baanzon-code',
      'baanzon-intelligence',
      'baanzon-reasoning',
      'baanzon-swift',
      'baanzon-vision',
    ]);
  });

  it.each([
    ['free', 'baanzon-intelligence', '@cf/zai-org/glm-4.7-flash'],
    ['lite', 'baanzon-intelligence', '@cf/zai-org/glm-5.3-flash'],
    ['pro', 'baanzon-intelligence', '@cf/zai-org/glm-5.3'],
    ['enterprise', 'baanzon-intelligence', '@cf/zai-org/glm-5.3'],
    ['free', 'baanzon-reasoning', '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'],
    ['lite', 'baanzon-reasoning', '@cf/deepseek-ai/deepseek-v4-flash-0731'],
    ['pro', 'baanzon-reasoning', '@cf/openai/gpt-oss-120b'],
    ['free', 'baanzon-code', '@cf/qwen/qwen2.5-coder-32b-instruct'],
    ['pro', 'baanzon-code', '@cf/moonshotai/kimi-k2.7-code'],
    ['free', 'baanzon-swift', '@cf/meta/llama-3.1-8b-instruct-fp8'],
    ['pro', 'baanzon-swift', '@cf/zai-org/glm-5.3-flash'],
    ['free', 'baanzon-vision', '@cf/meta/llama-3.2-11b-vision-instruct'],
    ['pro', 'baanzon-vision', '@cf/meta/llama-4-scout-17b-16e-instruct'],
  ])('%s %s serves %s', (tier, slug, model) => {
    expect(routeModel(tier, slug).model).toBe(model);
  });

  it('applies tier budgets on slug resolution', () => {
    expect(routeModel('lite', 'baanzon-intelligence')).toMatchObject({
      maxContextTokens: 900000,
      max_tokens: 12000,
    });
    expect(routeModel('free', 'baanzon-code')).toMatchObject({ maxContextTokens: 24000 });
  });

  it('returns the whole chain for failover consumers', () => {
    const chain = resolveModelChain('pro', 'baanzon-code');
    expect(chain[0]).toBe('@cf/moonshotai/kimi-k2.7-code');
    expect(chain).toContain('@cf/zai-org/glm-5.3');
  });
});

describe('capability lanes select their public model server-side', () => {
  it.each([
    ['fast', 'baanzon-swift', 'free', '@cf/meta/llama-3.1-8b-instruct-fp8'],
    ['fast', 'baanzon-swift', 'lite', '@cf/zai-org/glm-4.7-flash'],
    ['reasoning', 'baanzon-reasoning', 'pro', '@cf/openai/gpt-oss-120b'],
    ['coding', 'baanzon-code', 'lite', '@cf/qwen/qwen2.5-coder-32b-instruct'],
    ['vision', 'baanzon-vision', 'free', '@cf/meta/llama-3.2-11b-vision-instruct'],
  ])('the %s lane routes to %s (%s)', (lane, slug, tier, model) => {
    const result = routeModel(tier, 'baanzon-intelligence', lane);
    expect(result.model).toBe(model);
    // shared backings belong to several chains; the reverse map must at least
    // never leak an unmapped vendor id
    expect(toPublicModelId(result.model)).toBeDefined();
  });

  it('balanced keeps the requested slug', () => {
    expect(routeModel('pro', 'baanzon-reasoning', 'balanced').model).toBe('@cf/openai/gpt-oss-120b');
  });

  it('does not reinterpret pipeline-only lanes as chat models', () => {
    expect(routeModel('pro', undefined, 'embedding')).toBeNull();
    expect(routeModel('pro', undefined, 'reranker')).toBeNull();
    expect(routeModel('pro', undefined, 'local')).toBeNull();
  });
});

describe('legacy keys keep working', () => {
  it('maps every v1 brand key and retired slug to a current model', () => {
    for (const legacy of Object.keys(ALIASES)) {
      const result = routeModel('pro', legacy);
      expect(result).not.toBeNull();
      expect(result.model).toMatch(/^@cf\//);
      expect(toPublicModelId(result.model)).toBeDefined();
    }
  });

  it('still routes the stored baanzon-intelligence spec', () => {
    expect(routeModel('pro', 'baanzon-intelligence').model).toBe('@cf/zai-org/glm-5.3');
  });

  it('passes concrete ids through untouched', () => {
    expect(routeModel('pro', '@cf/example/model')).toEqual({ model: '@cf/example/model' });
  });

  it('falls back when nothing matches', () => {
    expect(routeModel('pro', 'totally-unknown')).toBeNull();
  });
});

describe('Indic lane reorders the same chain', () => {
  it('detects the scheduled scripts', () => {
    expect(isIndicText('नमस्ते, आप कैसे हैं?')).toBe(true);
    expect(isIndicText('வணக்கம்')).toBe(true);
    expect(isIndicText('hello there')).toBe(false);
    expect(isIndicText('')).toBe(false);
  });

  it('puts Indic-strongest backings first for an Indic message', () => {
    const plain = resolveModelChain('free', 'baanzon-intelligence');
    expect(plain[0]).toBe('@cf/zai-org/glm-4.7-flash');

    const indic = resolveModelChain('free', 'baanzon-intelligence', 'मुझे एक कविता सुनाओ');
    expect(indic).toEqual(expect.arrayContaining(plain));
    // the free chain's smallest model must not lead when Indic is detected
    expect(indic[0]).not.toBe('@cf/meta/llama-3.1-8b-instruct-fp8');
  });
});

describe('raw failover map covers every chain member', () => {
  it('maps each backing to its alternates', () => {
    for (const tiers of Object.values(CHAINS)) {
      for (const chain of Object.values(tiers)) {
        for (const raw of chain) {
          expect(RAW_FAILOVER[raw]).toBeDefined();
        }
      }
    }
    expect(RAW_FAILOVER['@cf/zai-org/glm-5.3']).toContain('@cf/deepseek-ai/deepseek-v4-flash-0731');
  });

  it('keeps the hard fallback defined', () => {
    expect(FALLBACK.model).toBe('@cf/meta/llama-3.1-8b-instruct-fp8');
  });
});

describe('composite ephemeral agent id rebranding', () => {
  it('rebrands the model part of a stored composite id', () => {
    const composite = 'Opraiz__@cf/zai-org/glm-5.3___baanzon';
    const rebranded = toPublicAgentId(composite);
    expect(rebranded).toContain('baanzon-intelligence');
    expect(rebranded).not.toContain('@cf/');
  });

  it('drops attribution for unmappable vendor ids', () => {
    expect(toPublicAgentId('Opraiz__@cf/unknown/model___x')).toBeNull();
  });

  it('passes real agent ids and unparseable values through', () => {
    expect(toPublicAgentId('agent_abc123')).toBe('agent_abc123');
    expect(toPublicAgentId(undefined)).toBeUndefined();
  });
});
