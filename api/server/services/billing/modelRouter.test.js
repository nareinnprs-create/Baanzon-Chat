const { routeModel, toPublicModelId, PUBLIC_MODELS, MATRIX } = require('./modelRouter');

describe('model lane routing', () => {
  it.each([
    ['fast', 'baanzon-ai'],
    ['balanced', 'baanzon-ai'],
    ['reasoning', 'baanzon-ara'],
    ['coding', 'baanzon-chenni'],
  ])('routes the %s lane through the existing brand matrix', (lane, brand) => {
    const result = routeModel('pro', undefined, lane);

    expect(result).toMatchObject({ lane });
    expect(result.model).toBe(MATRIX[brand].pro.model);
  });

  it('does not reinterpret pipeline-only lanes as chat models', () => {
    expect(routeModel('pro', undefined, 'embedding')).toBeNull();
    expect(routeModel('pro', undefined, 'reranker')).toBeNull();
    expect(routeModel('pro', undefined, 'local')).toBeNull();
  });

  it('lets an explicit lane replace a stale concrete model ID', () => {
    expect(routeModel('pro', '@cf/example/model', 'coding')).toMatchObject({
      model: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      lane: 'coding',
    });
  });
});

describe('public model keys', () => {
  it('resolves a spec key to its concrete model without a tier budget override', () => {
    expect(routeModel('pro', 'baanzon-intelligence')).toEqual({ model: '@cf/zai-org/glm-5.3' });
  });

  it('never lets a public key fall through to brand routing', () => {
    for (const key of Object.keys(PUBLIC_MODELS)) {
      const result = routeModel('free', key);
      expect(result).toEqual({ model: PUBLIC_MODELS[key] });
    }
  });

  it('keeps a lane winning over a requested public key', () => {
    expect(routeModel('pro', 'baanzon-intelligence', 'coding')).toMatchObject({
      model: MATRIX['baanzon-chenni'].pro.model,
      lane: 'coding',
    });
  });

  it('maps concrete ids back to the first public key that serves them', () => {
    expect(toPublicModelId('@cf/zai-org/glm-5.3')).toBe('baanzon-intelligence');
    expect(toPublicModelId('@cf/moonshotai/kimi-k2.7-code')).toBe('baanzon-code-xl');
    expect(toPublicModelId('baanzon-ai')).toBeUndefined();
    expect(toPublicModelId(undefined)).toBeUndefined();
  });
});
