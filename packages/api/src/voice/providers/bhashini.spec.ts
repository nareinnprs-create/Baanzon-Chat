import {
  bhashiniAsr,
  bhashiniTts,
  parseAsrResponse,
  parsePipelineResponse,
  parseTtsResponse,
  resolveBhashiniPipeline,
} from './bhashini';

const credentials = { userId: 'u', ulcaApiKey: 'k', pipelineId: 'p1' };

const pipelinePayload = {
  pipelineInferenceAPIEndPoint: {
    callbackUrl: 'https://inference.example/asr',
    inferenceApiKey: { name: 'Authorization', value: 'token-123' },
  },
  pipelineResponseConfig: [
    { taskType: 'asr', config: [{ serviceId: 'asr-svc' }] },
    { taskType: 'tts', config: [{ serviceId: 'tts-svc' }] },
  ],
};

describe('parsePipelineResponse', () => {
  it('extracts the callback, auth and per-task service ids', () => {
    expect(parsePipelineResponse(pipelinePayload)).toEqual({
      callbackUrl: 'https://inference.example/asr',
      authName: 'Authorization',
      authValue: 'token-123',
      serviceIds: { asr: 'asr-svc', tts: 'tts-svc' },
    });
  });

  it('rejects a payload without an inference endpoint', () => {
    expect(parsePipelineResponse({})).toBeNull();
  });
});

describe('resolveBhashiniPipeline', () => {
  it('sends the ULCA headers and pipeline body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pipelinePayload),
    });
    const pipeline = await resolveBhashiniPipeline({
      credentials,
      tasks: ['asr', 'tts'],
      language: 'ta',
      fetchImpl,
    });

    expect(pipeline?.serviceIds.tts).toBe('tts-svc');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/ulca/apis/v0/model/getModelsPipeline');
    expect(init.headers.userID).toBe('u');
    expect(init.headers.ulcaApiKey).toBe('k');
    expect(JSON.parse(init.body)).toMatchObject({
      pipelineRequestConfig: { pipelineId: 'p1' },
      pipelineTasks: [
        { taskType: 'asr', config: { language: { sourceLanguage: 'ta' } } },
        { taskType: 'tts', config: { language: { sourceLanguage: 'ta' } } },
      ],
    });
  });

  it('returns null when the platform rejects the credentials', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    expect(
      await resolveBhashiniPipeline({ credentials, tasks: ['asr'], language: 'ta', fetchImpl }),
    ).toBeNull();
  });
});

describe('inference parsing', () => {
  it('reads the ASR transcript and the TTS audio', () => {
    expect(
      parseAsrResponse({
        pipelineResponse: [{ taskType: 'asr', output: [{ source: ' வணக்கம் ' }] }],
      }),
    ).toBe('வணக்கம்');
    expect(
      parseTtsResponse({
        pipelineResponse: [{ taskType: 'tts', audio: [{ audioContent: 'UklGRg==' }] }],
      }),
    ).toEqual(Buffer.from('RIFF', 'binary'));
    expect(parseAsrResponse({ pipelineResponse: [] })).toBeNull();
    expect(parseTtsResponse({ pipelineResponse: [] })).toBeNull();
  });
});

describe('bhashiniAsr / bhashiniTts', () => {
  const pipeline = {
    callbackUrl: 'https://inference.example/asr',
    authName: 'Authorization',
    authValue: 'token-123',
    serviceIds: { asr: 'asr-svc', tts: 'tts-svc' },
  };

  it('posts audio with the language, format and service id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ pipelineResponse: [{ taskType: 'asr', output: [{ source: 'hi' }] }] }),
    });
    const text = await bhashiniAsr({
      pipeline,
      audio: Buffer.from('wav'),
      language: 'ta',
      fetchImpl,
    });

    expect(text).toBe('hi');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://inference.example/asr');
    expect(init.headers.Authorization).toBe('token-123');
    const body = JSON.parse(init.body);
    expect(body.pipelineTasks[0].config).toMatchObject({
      serviceId: 'asr-svc',
      audioFormat: 'wav',
      language: { sourceLanguage: 'ta' },
    });
    expect(body.inputData.audio[0].audioContent).toBe(Buffer.from('wav').toString('base64'));
  });

  it('posts text for synthesis and returns the audio bytes', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          pipelineResponse: [{ taskType: 'tts', audio: [{ audioContent: 'UklGRg==' }] }],
        }),
    });
    const wav = await bhashiniTts({ pipeline, text: 'வணக்கம்', language: 'ta', fetchImpl });

    expect(wav).toEqual(Buffer.from('RIFF', 'binary'));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.pipelineTasks[0].config).toMatchObject({ serviceId: 'tts-svc', gender: 'female' });
    expect(body.inputData.input[0].source).toBe('வணக்கம்');
  });

  it('returns null when a task has no service id', async () => {
    const fetchImpl = jest.fn();
    expect(
      await bhashiniAsr({
        pipeline: { ...pipeline, serviceIds: {} },
        audio: Buffer.alloc(1),
        language: 'ta',
        fetchImpl,
      }),
    ).toBeNull();
    expect(
      await bhashiniTts({
        pipeline: { ...pipeline, serviceIds: {} },
        text: 'x',
        language: 'ta',
        fetchImpl,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
