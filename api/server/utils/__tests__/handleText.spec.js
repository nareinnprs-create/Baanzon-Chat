jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return { __esModule: true, ...actual, sendEvent: jest.fn() };
});

const {
  Capabilities,
  EModelEndpoint,
  defaultRetrievalModels,
  defaultAssistantsVersion,
  defaultAgentCapabilities,
} = require('librechat-data-provider');
const { sendEvent } = require('@librechat/api');
const {
  handleText,
  formatSteps,
  formatAction,
  generateConfig,
  addSpaceIfNeeded,
  createOnProgress,
} = require('../handleText');

describe('addSpaceIfNeeded', () => {
  it('appends a single space to non-empty text without a trailing space', () => {
    expect(addSpaceIfNeeded('hello')).toBe('hello ');
  });

  it('leaves empty strings and already-spaced text unchanged', () => {
    expect(addSpaceIfNeeded('')).toBe('');
    expect(addSpaceIfNeeded('hello ')).toBe('hello ');
  });
});

describe('handleText', () => {
  it('returns the text and writes it back onto the response', async () => {
    const response = { text: 'final answer' };

    await expect(handleText(response)).resolves.toBe('final answer');
    expect(response.text).toBe('final answer');
  });
});

describe('formatSteps', () => {
  it('joins Input/Output blocks with a separator between steps', () => {
    const steps = [
      { action: { toolInput: 'query one' }, observation: 'result one' },
      { action: { toolInput: 'query two' }, observation: 'result two' },
    ];

    expect(formatSteps(steps)).toBe(
      'Input: query one\nOutput: result one\n---\nInput: query two\nOutput: result two',
    );
  });

  it('stringifies object inputs', () => {
    const steps = [{ action: { toolInput: { q: 'x' } }, observation: 'result' }];

    expect(formatSteps(steps)).toBe('Input: {"q":"x"}\nOutput: result');
  });

  it('skips steps with an N/A input or an empty observation', () => {
    const steps = [
      { action: { toolInput: 'N/A' }, observation: 'ignored' },
      { action: { toolInput: 'whitespace observation' }, observation: '   ' },
      { action: { toolInput: 'kept' }, observation: 'ok' },
    ];

    expect(formatSteps(steps)).toBe('Input: kept\nOutput: ok');
  });

  it('returns an empty string when there are no usable steps', () => {
    expect(formatSteps([])).toBe('');
    expect(formatSteps([{ action: { toolInput: 'N/A' }, observation: 'x' }])).toBe('');
  });
});

describe('formatAction', () => {
  it('builds a plugin/input/thought block and strips the "Thought: " prefix', () => {
    const result = formatAction({
      tool: 'search',
      toolInput: 'cats',
      log: 'Thought: find cats\nmore log',
    });

    expect(result.plugin).toBe('search');
    expect(result.input).toBe('cats');
    expect(result.thought).toBe('find cats');
    expect(result.inputStr).toContain('plugin: search');
    expect(result.inputStr).toContain('input: cats');
    expect(result.inputStr).toContain('thought: find cats');
  });

  it('omits the thought line when the first log line is empty', () => {
    const result = formatAction({ tool: 'search', toolInput: 'x', log: '' });

    expect(result.thought).toBe('');
    expect(result.inputStr).not.toContain('thought:');
  });

  it('uses the self-reflection template for the self-reflection tool', () => {
    const result = formatAction({
      tool: 'self-reflection',
      toolInput: 'why',
      log: 'because reasons',
    });

    expect(result.inputStr).toBe('{\n\tthought: why - because reasons\n}');
  });

  it('collapses the N/A placeholder in the self-reflection template', () => {
    const result = formatAction({ tool: 'N/A', toolInput: 'N/A', log: 'N/A' });

    expect(result.plugin).toBe('N/A');
    expect(result.inputStr).toBe('{\n\tthought: N/A\n}');
  });
});

describe('generateConfig', () => {
  it('returns false without a key', () => {
    expect(generateConfig()).toBe(false);
    expect(generateConfig('')).toBe(false);
  });

  it('flags user-provided keys and base URLs', () => {
    expect(generateConfig('sk-123')).toEqual({ userProvide: false });
    expect(generateConfig('user_provided', 'https://api.example.com')).toEqual({
      userProvide: true,
      userProvideURL: false,
    });
    expect(generateConfig('sk-123', 'user_provided')).toEqual({
      userProvide: false,
      userProvideURL: true,
    });
  });

  it('adds retrieval models, capabilities and version for assistants', () => {
    const config = generateConfig('sk-123', null, EModelEndpoint.assistants);

    expect(config.retrievalModels).toEqual(defaultRetrievalModels);
    expect(config.capabilities).toEqual([
      Capabilities.code_interpreter,
      Capabilities.image_vision,
      Capabilities.retrieval,
      Capabilities.actions,
      Capabilities.tools,
    ]);
    expect(config.version).toBe(defaultAssistantsVersion.assistants);
  });

  it('uses the azure version for azureAssistants', () => {
    const config = generateConfig('sk-123', null, EModelEndpoint.azureAssistants);

    expect(config.version).toBe(defaultAssistantsVersion.azureAssistants);
  });

  it('uses agent capabilities for the agents endpoint', () => {
    const config = generateConfig('sk-123', null, EModelEndpoint.agents);

    expect(config.capabilities).toEqual(defaultAgentCapabilities);
    expect(config.retrievalModels).toBeUndefined();
    expect(config.version).toBeUndefined();
  });
});

describe('createOnProgress', () => {
  let res;

  beforeEach(() => {
    res = {};
    sendEvent.mockClear();
  });

  it('accumulates text and marks only the first event as initial', () => {
    const { onProgress, getPartialText } = createOnProgress({ generation: 'Hello' });
    const push = onProgress({ res });

    push('world');
    expect(sendEvent).toHaveBeenNthCalledWith(1, res, {
      message: true,
      initial: true,
      text: 'Hello world',
    });

    push('!');
    expect(sendEvent).toHaveBeenNthCalledWith(2, res, {
      message: true,
      initial: false,
      text: 'Hello world!',
    });
    expect(getPartialText()).toBe('Hello world!');
  });

  it('adds a trailing space to a non-empty generation seed', () => {
    const { onProgress } = createOnProgress({ generation: 'Seed' });

    onProgress({ res })('x');

    expect(sendEvent).toHaveBeenCalledWith(res, {
      message: true,
      initial: true,
      text: 'Seed x',
    });
  });

  it('merges extra payload fields into streamed events', () => {
    const { onProgress } = createOnProgress();
    const push = onProgress({ res, messageId: 'm1', conversationId: 'c1' });

    push('hi');

    expect(sendEvent).toHaveBeenCalledWith(res, {
      message: true,
      initial: true,
      text: 'hi',
      messageId: 'm1',
      conversationId: 'c1',
    });
  });

  it('invokes the onProgress observer with the emitted payload', () => {
    const observer = jest.fn();
    const { onProgress } = createOnProgress({ onProgress: observer });

    onProgress({ res })('chunk');

    expect(observer).toHaveBeenCalledWith({ message: true, initial: true, text: 'chunk' });
  });

  it('sendIntermediateMessage appends extra tokens and flips initial', () => {
    const { sendIntermediateMessage, getPartialText } = createOnProgress({ generation: 'A' });

    sendIntermediateMessage(res, { type: 'info' }, 'BC');
    expect(sendEvent).toHaveBeenCalledWith(res, {
      message: true,
      initial: true,
      text: 'A BC',
      type: 'info',
    });
    expect(getPartialText()).toBe('A BC');

    sendIntermediateMessage(res, {}, 'D');
    expect(sendEvent).toHaveBeenLastCalledWith(res, {
      message: true,
      initial: false,
      text: 'A BCD',
    });
  });
});
