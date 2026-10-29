import { ErrorTypes, EModelEndpoint } from 'librechat-data-provider';
import { GraphRecursionError } from '@langchain/langgraph';
import {
  GENERIC_PROVIDER_ERROR,
  getLangChainErrorCode,
  resolveLangChainError,
  getUserFacingProviderError,
  isFatalAgentInitializationError,
  AGENT_ATTACHMENT_LIMIT_EXCEEDED,
  AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE,
  isStepLimitError,
  resolveProviderAuthError,
  ProviderAuthError,
} from './errors';

describe('resolveProviderAuthError', () => {
  it('normalizes a 401 into a typed error naming the provider and status', () => {
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });
    const normalized = resolveProviderAuthError(error, { provider: 'openAI', endpoint: 'Mistral' });
    expect(normalized).toBeInstanceOf(ProviderAuthError);
    expect(normalized?.provider).toBe('Mistral');
    expect(normalized?.status).toBe(401);
    expect(normalized?.message).toBe('Invalid API key — Mistral rejected the key (401)');
  });

  it('normalizes a 403 as an access-denied message', () => {
    const error = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    const normalized = resolveProviderAuthError(error, { provider: 'openAI', endpoint: 'Mistral' });
    expect(normalized?.status).toBe(403);
    expect(normalized?.message).toBe('Mistral rejected the request (403)');
  });

  it('falls back to the provider name when the endpoint is the agents endpoint', () => {
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });
    const normalized = resolveProviderAuthError(error, {
      provider: 'openAI',
      endpoint: EModelEndpoint.agents,
    });
    expect(normalized?.provider).toBe('openAI');
    expect(normalized?.message).toBe('Invalid API key — openAI rejected the key (401)');
  });

  it('recovers the status from a wrapped cause and defaults the fallback name', () => {
    const wrapped = new Error('Request failed', {
      cause: Object.assign(new Error('Unauthorized'), { status: 401 }),
    });
    const normalized = resolveProviderAuthError(wrapped, {});
    expect(normalized).toBeInstanceOf(ProviderAuthError);
    expect(normalized?.message).toBe('Invalid API key — The provider rejected the key (401)');
  });

  it.each([
    Object.assign(new Error('rate limited'), { status: 429 }),
    new Error('Unauthorized'),
    { message: 'Unauthorized', status: '401' },
  ])('returns undefined for non-auth failures (%p)', (error) => {
    expect(resolveProviderAuthError(error, { provider: 'Mistral' })).toBeUndefined();
  });
});

describe('isFatalAgentInitializationError', () => {
  it.each([
    ErrorTypes.RESOURCE_RECOVERY_REQUIRED,
    ErrorTypes.STATEFUL_CODE_ENVIRONMENT_NOT_ALLOWED,
    ErrorTypes.CODE_WORKSPACE_UNAVAILABLE,
    AGENT_ATTACHMENT_LIMIT_EXCEEDED,
    AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE,
  ])('classifies %s as fatal', (code) => {
    expect(isFatalAgentInitializationError({ code })).toBe(true);
  });

  it('allows skill-added MCP tools to fall back while keeping resource recovery fatal', () => {
    const options = { allowExpectedMCPFallback: true };
    expect(
      isFatalAgentInitializationError({ code: AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE }, options),
    ).toBe(false);
    expect(
      isFatalAgentInitializationError({ code: ErrorTypes.RESOURCE_RECOVERY_REQUIRED }, options),
    ).toBe(true);
  });

  it.each([undefined, null, new Error('optional tool failed'), { code: 'OPTIONAL_TOOL_FAILED' }])(
    'keeps non-fatal failures eligible for legacy soft handling',
    (error) => {
      expect(isFatalAgentInitializationError(error)).toBe(false);
    },
  );
});

describe('LangChain provider error text', () => {
  /** The exact tail `addLangChainErrorFields` appends to `error.message`. */
  const troubleshooting = (code: string) =>
    `\n\nTroubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/${code}/\n`;

  describe('getLangChainErrorCode', () => {
    it('prefers the field LangChain stamps on the error', () => {
      const error = Object.assign(new Error('429 budget exceeded'), {
        lc_error_code: 'MODEL_RATE_LIMIT',
      });
      expect(getLangChainErrorCode(error)).toBe('MODEL_RATE_LIMIT');
    });

    it('recovers the code from the message when the field did not survive', () => {
      const error = new Error(`404 page not found${troubleshooting('MODEL_NOT_FOUND')}`);
      expect(getLangChainErrorCode(error)).toBe('MODEL_NOT_FOUND');
    });

    it.each([undefined, null, 'plain text', new Error('429 Too Many Requests')])(
      'returns undefined for an unclassified error',
      (error) => {
        expect(getLangChainErrorCode(error)).toBeUndefined();
      },
    );

    it('survives an error-like object whose message is not a string', () => {
      expect(getLangChainErrorCode({ message: { error: 'rate limited' } })).toBeUndefined();
    });
  });

  describe('resolveLangChainError', () => {
    it.each([
      ['MODEL_RATE_LIMIT', ErrorTypes.MODEL_RATE_LIMIT],
      ['MODEL_NOT_FOUND', ErrorTypes.MODEL_NOT_FOUND],
    ])('maps %s to the typed payload the client localizes', (code, type) => {
      const error = Object.assign(new Error('failed'), { lc_error_code: code });
      expect(resolveLangChainError(error)).toBe(JSON.stringify({ type }));
    });

    it('leaves codes without localized copy to the provider message', () => {
      const error = Object.assign(new Error('failed'), { lc_error_code: 'OUTPUT_PARSING_FAILURE' });
      expect(resolveLangChainError(error)).toBeUndefined();
    });
  });

  describe('getUserFacingProviderError', () => {
    it('strips the docs URL from the forwarded provider message', () => {
      const error = new Error(`429 budget exceeded${troubleshooting('MODEL_RATE_LIMIT')}`);
      expect(getUserFacingProviderError(error, false)).toBe('429 budget exceeded');
    });

    it('withholds provider text when content protection is enabled', () => {
      const error = new Error(`429 budget exceeded${troubleshooting('MODEL_RATE_LIMIT')}`);
      expect(getUserFacingProviderError(error, true)).toBe(GENERIC_PROVIDER_ERROR);
    });

    it('falls back when stripping leaves nothing behind', () => {
      const error = new Error(troubleshooting('MODEL_RATE_LIMIT').trim());
      expect(getUserFacingProviderError(error, false)).toBe(GENERIC_PROVIDER_ERROR);
    });

    it('does not attempt to read a message off a non-Error rejection', () => {
      expect(getUserFacingProviderError('boom', false)).toBe('An error occurred');
    });

    it('coerces an Error whose message was overwritten with an object', () => {
      const error = Object.assign(new Error('replaced'), { message: { error: 'rate limited' } });
      expect(getUserFacingProviderError(error, false)).toBe('[object Object]');
    });
  });
});

describe('isStepLimitError', () => {
  it('recognizes the real error LangGraph throws when a graph runs out of supersteps', () => {
    /** Constructed exactly as `pregel/index.js` does on `loop.status === 'out_of_steps'`. */
    const thrown = new GraphRecursionError(
      'Recursion limit of 50 reached without hitting a stop condition. You can increase the limit by setting the "recursionLimit" config key.',
      { lc_error_code: 'GRAPH_RECURSION_LIMIT' },
    );

    expect(isStepLimitError(thrown)).toBe(true);
  });

  it('matches on `lc_error_code` alone, so a minified class name cannot break detection', () => {
    expect(isStepLimitError({ lc_error_code: 'GRAPH_RECURSION_LIMIT' })).toBe(true);
  });

  it('matches on `name` alone, so an error rebuilt without fields is still recognized', () => {
    expect(isStepLimitError({ name: 'GraphRecursionError' })).toBe(true);
  });

  it('unwraps a graph error rethrown inside a wrapper', () => {
    const wrapper = new Error('agent run failed', {
      cause: new Error('node failed', {
        cause: new GraphRecursionError('Recursion limit of 50 reached', {
          lc_error_code: 'GRAPH_RECURSION_LIMIT',
        }),
      }),
    });

    expect(isStepLimitError(wrapper)).toBe(true);
  });

  it('terminates on a self-referential cause chain instead of looping forever', () => {
    const looping: { name: string; cause?: unknown } = { name: 'SomeError' };
    looping.cause = looping;

    expect(isStepLimitError(looping)).toBe(false);
  });

  it.each([
    undefined,
    null,
    'GraphRecursionError',
    new Error('rate limited'),
    { lc_error_code: 'GRAPH_VALUE_ERROR' },
    { name: 'GraphInterrupt' },
  ])('leaves case %# on the ordinary error path', (error) => {
    expect(isStepLimitError(error)).toBe(false);
  });
});
