const { routeModel } = require('./modelRouter');

describe('model lane routing', () => {
  it.each([
    ['fast', 'baanzon-ai'],
    ['balanced', 'baanzon-ai'],
    ['reasoning', 'baanzon-ara'],
    ['coding', 'baanzon-chenni'],
  ])('routes the %s lane through the existing brand matrix', (lane, brand) => {
    const result = routeModel('pro', undefined, lane);

    expect(result).toMatchObject({ lane });
    expect(result.model).toBe(require('./modelRouter').MATRIX[brand].pro.model);
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
