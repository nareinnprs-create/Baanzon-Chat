const axios = require('axios');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { Tool } = require('@librechat/agents/langchain/tools');
const {
  applyAxiosProxyConfig,
  createMinimalRetentionRequest,
  getHttpsProxyAgent,
} = require('@librechat/api');
const { FileContext, ContentTypes } = require('librechat-data-provider');

jest.mock('axios');
jest.mock('node-fetch');
jest.mock('uuid');
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));
jest.mock(
  '@librechat/agents/langchain/tools',
  () => ({
    Tool: class {},
  }),
  { virtual: true },
);
jest.mock('librechat-data-provider', () => ({
  FileContext: { image_generation: 'image_generation' },
  ContentTypes: { IMAGE_URL: 'image_url', TEXT: 'text' },
}));
jest.mock('@librechat/api', () => ({
  applyAxiosProxyConfig: jest.fn((config) => config),
  createMinimalRetentionRequest: jest.fn(() => ({})),
  getHttpsProxyAgent: jest.fn(() => null),
}));

const FluxAPI = require('../FluxAPI');

describe('FluxAPI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    uuidv4.mockReturnValue('test-uuid');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('polling timeout', () => {
    it('should throw descriptive error on polling timeout', async () => {
      const tool = new FluxAPI({ FLUX_API_KEY: 'test-key' });
      const processFileURL = jest.fn();
      tool.processFileURL = processFileURL;

      // Mock successful task submission
      axios.post.mockResolvedValueOnce({
        data: { id: 'test-task-id' },
      });

      // Mock polling to always return Pending
      axios.get.mockResolvedValue({
        data: { status: 'Pending' },
      });

      const callPromise = tool._call({
        prompt: 'test prompt',
        endpoint: '/v1/flux-pro',
      });

      // Advance timers to trigger timeout
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(120000);

      await expect(callPromise).rejects.toThrow(/Flux API polling timed out after \d+s/);
      expect(logger.error).toHaveBeenCalled();
    }, 15000);

    it('should throw descriptive error on finetuned polling timeout', async () => {
      const tool = new FluxAPI({ FLUX_API_KEY: 'test-key' });
      const processFileURL = jest.fn();
      tool.processFileURL = processFileURL;

      // Mock successful task submission
      axios.post.mockResolvedValueOnce({
        data: { id: 'test-task-id' },
      });

      // Mock polling to always return Pending
      axios.get.mockResolvedValue({
        data: { status: 'Pending' },
      });

      const callPromise = tool._call({
        prompt: 'test prompt',
        action: 'generate_finetuned',
        finetune_id: 'finetune-123',
        endpoint: '/v1/flux-pro-finetuned',
      });

      // Advance timers to trigger timeout
      await jest.runOnlyPendingTimersAsync();
      await jest.advanceTimersByTimeAsync(120000);

      await expect(callPromise).rejects.toThrow(/Flux API polling timed out after \d+s/);
      expect(logger.error).toHaveBeenCalled();
    }, 15000);
  });

  describe('normal operation', () => {
    it('should handle successful generation', async () => {
      const tool = new FluxAPI({ FLUX_API_KEY: 'test-key' });
      const processFileURL = jest.fn().mockResolvedValue({
        filepath: '/images/img-test-uuid.png',
      });
      tool.processFileURL = processFileURL;

      // Mock successful task submission
      axios.post.mockResolvedValueOnce({
        data: { id: 'test-task-id' },
      });

      // Mock polling to return Ready
      axios.get.mockResolvedValueOnce({
        data: {
          status: 'Ready',
          result: { sample: 'https://example.com/image.png' },
        },
      });

      const resultPromise = tool._call({
        prompt: 'test prompt',
        endpoint: '/v1/flux-pro',
      });

      // Fast forward timers to complete polling
      await jest.runAllTimersAsync();

      const result = await resultPromise;

      expect(axios.post).toHaveBeenCalled();
      expect(axios.get).toHaveBeenCalled();
      expect(processFileURL).toHaveBeenCalled();
    }, 15000);
  });
});
