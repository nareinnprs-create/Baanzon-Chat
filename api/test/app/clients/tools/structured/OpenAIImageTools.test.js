const OpenAI = require('openai');

const mockFormData = jest.fn().mockImplementation(function () {
  this.appends = [];
  this.append = jest.fn((name, value, opts) => this.appends.push({ name, value, opts }));
  this.getHeaders = jest.fn(() => ({
    'content-type': 'multipart/form-data; boundary=test-boundary',
  }));
  return this;
});

jest.mock('form-data', () => mockFormData);

const createOpenAIImageTools = require('~/app/clients/tools/structured/OpenAIImageTools');

jest.mock('openai');
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  oaiToolkit: {
    image_gen_oai: {
      name: 'image_gen_oai',
      description: 'Generate an image',
      schema: {},
    },
    image_edit_oai: {
      name: 'image_edit_oai',
      description: 'Edit an image',
      schema: {},
    },
  },
  extractBaseURL: jest.fn((url) => url),
  getProxyDispatcher: jest.fn(() => undefined),
  applyAxiosProxyConfig: jest.fn(),
  getBalanceConfig: jest.fn(() => ({ enabled: true })),
  getTransactionsConfig: jest.fn(() => ({ enabled: true })),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({
    getDownloadStream: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
  spendTokens: jest.fn().mockResolvedValue(undefined),
}));

const { spendTokens } = require('~/models');
const axios = require('axios');

jest.mock('axios', () => ({
  post: jest.fn(),
}));

describe('OpenAIImageTools - IMAGE_GEN_OAI_MODEL environment variable', () => {
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };

    process.env.IMAGE_GEN_OAI_API_KEY = 'test-api-key';

    OpenAI.mockImplementation(() => ({
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [
            {
              b64_json: 'base64-encoded-image-data',
            },
          ],
        }),
      },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use default model "gpt-image-1" when IMAGE_GEN_OAI_MODEL is not set', async () => {
    delete process.env.IMAGE_GEN_OAI_MODEL;

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const mockGenerate = jest.fn().mockResolvedValue({
      data: [
        {
          b64_json: 'base64-encoded-image-data',
        },
      ],
    });

    OpenAI.mockImplementation(() => ({
      images: {
        generate: mockGenerate,
      },
    }));

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-1',
      }),
      expect.any(Object),
    );
  });

  it('should use "gpt-image-1.5" when IMAGE_GEN_OAI_MODEL is set to "gpt-image-1.5"', async () => {
    process.env.IMAGE_GEN_OAI_MODEL = 'gpt-image-1.5';

    const mockGenerate = jest.fn().mockResolvedValue({
      data: [
        {
          b64_json: 'base64-encoded-image-data',
        },
      ],
    });

    OpenAI.mockImplementation(() => ({
      images: {
        generate: mockGenerate,
      },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-1.5',
      }),
      expect.any(Object),
    );
  });

  it('should use custom model name from IMAGE_GEN_OAI_MODEL environment variable', async () => {
    process.env.IMAGE_GEN_OAI_MODEL = 'custom-image-model';

    const mockGenerate = jest.fn().mockResolvedValue({
      data: [
        {
          b64_json: 'base64-encoded-image-data',
        },
      ],
    });

    OpenAI.mockImplementation(() => ({
      images: {
        generate: mockGenerate,
      },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'test prompt' });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-image-model',
      }),
      expect.any(Object),
    );
  });
});

describe('OpenAIImageTools - gpt-image-1 usage cost recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.IMAGE_GEN_OAI_API_KEY = 'test-api-key';
  });

  it('records prompt/completion tokens from resp.usage via spendTokens', async () => {
    const mockGenerate = jest.fn().mockResolvedValue({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      data: [{ b64_json: 'base64-encoded-image-data' }],
    });

    OpenAI.mockImplementation(() => ({
      images: { generate: mockGenerate },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'a cat' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(spendTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'test-user',
        model: 'gpt-image-1',
        context: 'image_generation',
      }),
      { promptTokens: 100, completionTokens: 50 },
    );
  });

  it('falls back to total_tokens when only total is present', async () => {
    const mockGenerate = jest.fn().mockResolvedValue({
      usage: { total_tokens: 250 },
      data: [{ b64_json: 'base64-encoded-image-data' }],
    });

    OpenAI.mockImplementation(() => ({
      images: { generate: mockGenerate },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    await imageGenTool.func({ prompt: 'a cat' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(spendTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'test-user',
        context: 'image_generation',
      }),
      { promptTokens: 250 },
    );
  });

  it('returns one content part and file id per generated image (n > 1)', async () => {
    const mockGenerate = jest.fn().mockResolvedValue({
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      data: [{ b64_json: 'first' }, { b64_json: 'second' }],
    });

    OpenAI.mockImplementation(() => ({
      images: { generate: mockGenerate },
    }));

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
    });

    const result = await imageGenTool.func({ prompt: 'two cats', n: 2 });
    const [, { content, file_ids }] = result;

    expect(content).toHaveLength(2);
    expect(file_ids).toHaveLength(2);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ n: 2 }),
      expect.any(Object),
    );
  });
});

describe('OpenAIImageTools - image edit validation (mask + multi-image)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.IMAGE_GEN_OAI_API_KEY = 'test-api-key';
    axios.post.mockResolvedValue({ data: { data: [{ b64_json: 'edited' }] } });
  });

  const imageFiles = [
    {
      file_id: 'img-1',
      source: 'local',
      filepath: '/tmp/source.png',
      filename: 'source.png',
      type: 'image/png',
      height: 100,
      width: 100,
    },
  ];

  const maskFiles = [
    {
      file_id: 'mask-1',
      source: 'local',
      filepath: '/tmp/mask.png',
      filename: 'mask.png',
      type: 'image/png',
      height: 100,
      width: 100,
    },
  ];

  it('throws when n is not an integer in 1..10', async () => {
    const [, imageEditTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
      imageFiles,
    });

    await expect(
      imageEditTool.func({ prompt: 'edit', image_ids: ['img-1'], n: 0 }),
    ).rejects.toThrow('`n` must be an integer between 1 and 10.');
    await expect(
      imageEditTool.func({ prompt: 'edit', image_ids: ['img-1'], n: 11 }),
    ).rejects.toThrow('`n` must be an integer between 1 and 10.');
    await expect(
      imageEditTool.func({ prompt: 'edit', image_ids: ['img-1'], n: 2.5 }),
    ).rejects.toThrow('`n` must be an integer between 1 and 10.');
  });

  it('throws when more than one mask image is provided', async () => {
    const [, imageEditTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
      imageFiles,
    });

    await expect(
      imageEditTool.func({
        prompt: 'edit',
        image_ids: ['img-1'],
        mask_ids: ['mask-1', 'mask-2'],
      }),
    ).rejects.toThrow('A maximum of one `mask_ids` image is supported.');
  });

  it('throws when the mask dimensions differ from the source image', async () => {
    const [, imageEditTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
      imageFiles: [
        ...imageFiles,
        { ...maskFiles[0], file_id: 'mask-big', height: 200, width: 200 },
      ],
    });

    await expect(
      imageEditTool.func({
        prompt: 'edit',
        image_ids: ['img-1'],
        mask_ids: ['mask-big'],
      }),
    ).rejects.toThrow('Mask dimensions must match the source image dimensions.');
  });

  it('appends the source image, mask and n to the edit request and records usage', async () => {
    axios.post.mockResolvedValue({
      data: {
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        data: [{ b64_json: 'edited' }, { b64_json: 'edited-2' }],
      },
    });

    const [, imageEditTool] = createOpenAIImageTools({
      isAgent: true,
      override: false,
      req: { user: { id: 'test-user' } },
      imageFiles: [...imageFiles, ...maskFiles],
    });

    const result = await imageEditTool.func({
      prompt: 'edit',
      image_ids: ['img-1'],
      mask_ids: ['mask-1'],
      n: 2,
    });

    expect(axios.post).toHaveBeenCalledWith('/images/edits', expect.anything(), expect.anything());
    const formData = mockFormData.mock.results[mockFormData.mock.results.length - 1].value;
    const fields = Object.fromEntries(formData.appends.map((entry) => [entry.name, entry.value]));

    expect(fields).toEqual(
      expect.objectContaining({
        model: 'gpt-image-1',
        n: '2',
        quality: 'auto',
        size: 'auto',
      }),
    );
    expect(formData.appends.filter((entry) => entry.name === 'image[]')).toHaveLength(1);
    expect(formData.appends.filter((entry) => entry.name === 'mask')).toHaveLength(1);

    const [, { content, file_ids }] = result;
    expect(content).toHaveLength(2);
    expect(file_ids).toHaveLength(2);

    await new Promise((resolve) => setImmediate(resolve));
    expect(spendTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'test-user',
        context: 'image_generation',
      }),
      { promptTokens: 20, completionTokens: 10 },
    );
  });
});
