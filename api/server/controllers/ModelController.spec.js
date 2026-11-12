const mockLoadConfigModels = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('~/server/services/Config', () => ({
  loadConfigModels: (...args) => mockLoadConfigModels(...args),
}));

const { loadModels } = require('./ModelController');

describe('loadModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves only the configured models, never the vendor default catalogs', async () => {
    const req = { user: { id: 'user-1' } };
    mockLoadConfigModels.mockResolvedValue({
      Opraiz: ['baanzon-intelligence', 'baanzon-flash'],
    });

    await expect(loadModels(req)).resolves.toEqual({
      Opraiz: ['baanzon-intelligence', 'baanzon-flash'],
    });
    expect(mockLoadConfigModels).toHaveBeenCalledWith(req);
  });
});
